import { Box3, Line3, Matrix4, Plane, Sphere, Vector3 } from 'three';
import { PointCloudOctree, PointCloudOctreeGeometryNode } from '../';
import { BinaryHeap } from '../utils/binary-heap';
import { lru, LRU } from '../utils/lru';
import { Attribute, Points } from './Points';
import { Profile } from './profile';

export interface ProfileSegment {
  start: Vector3;
  end: Vector3;
  cutPlane: Plane;
  halfPlane: Plane;
  length: number;
  points: Points;
}

export interface ProfileRequestCallback {
  onProgress: Function;
  onCancel: Function;
  onFinish: Function;
}

export class ProfileData {
  profile: Profile;
  segments: ProfileSegment[] = [];
  boundingBox: Box3 = new Box3();
  constructor(profile: Profile) {
    this.profile = profile;
    const { points } = this.profile;

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      const startGround = start.clone().setZ(0);
      const endGround = end.clone().setZ(0);
      const center = new Vector3().addVectors(endGround, startGround).multiplyScalar(0.5);
      const length = startGround.distanceTo(endGround);
      const side = new Vector3().subVectors(endGround, startGround).normalize();
      const up = new Vector3(0, 0, 1);
      const forward = new Vector3().crossVectors(side, up).normalize();
      const cutPlane = new Plane().setFromNormalAndCoplanarPoint(forward, startGround);
      const halfPlane = new Plane().setFromNormalAndCoplanarPoint(side, center);

      const segment: ProfileSegment = {
        start,
        end,
        cutPlane,
        halfPlane,
        length,
        points: new Points()
      };

      this.segments.push(segment);
    }

  }
  size (): number {
    let size = 0;

    for (const segment of this.segments) {
      size += segment.points.numPoints;
    }

    return size;
  }
}

export class ProfileRequest {
  pointcloud: PointCloudOctree;
  profile: Profile;
  maxDepth: number;
  callback: ProfileRequestCallback;
  temporaryResult: ProfileData;
  updateGeneratorInstance: IterableIterator<boolean> | null = null;
  pointsServed = 0;
  highestLevelServed = 0;
  cancelRequested = false;
  priorityQueue: BinaryHeap<{ node: PointCloudOctreeGeometryNode, weight: number}> = new BinaryHeap((x: any) => 1 / x.weight);
  lru: LRU = lru;

  constructor(pointcloud: PointCloudOctree, profile: Profile, maxDepth: number = Number.MAX_VALUE, callback: ProfileRequestCallback) {
    this.pointcloud = pointcloud;
    this.profile = profile;
    this.callback = callback;
    this.maxDepth = maxDepth;
    this.temporaryResult = new ProfileData(this.profile);

    this.initialize();
  }

  initialize() {
    this.priorityQueue.push({ node: this.pointcloud.pcoGeometry.root, weight: Infinity });
  }

  traverse(startingNode: PointCloudOctreeGeometryNode): void {
    const stack: PointCloudOctreeGeometryNode[] = [];

    for (let i = 0; i < 8; i++) {
      const child = startingNode.children[i];
      if (child && this.pointcloud.nodeIntersectsProfile(child, this.profile)) {
        stack.push(child);
      }
    }

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        break; // FU tslint
      }
      const weight = node.boundingSphere.radius;

      this.priorityQueue.push({ node, weight });

      if (node.level < this.maxDepth) {
        for (let i = 0; i < 8; i++) {
          const child = node.children[i];

          if (child && this.pointcloud.nodeIntersectsProfile(child, this.profile)) {
            stack.push(child);
          }
        }
      }
    }
  }

  update(): void {
    if (this.updateGeneratorInstance === null) {
      this.updateGeneratorInstance = this.updateGenerator();
    }

    const result = this.updateGeneratorInstance.next();

    if (result.done) {
      this.updateGeneratorInstance = null;
    }
  }

  * updateGenerator(): IterableIterator<boolean> {
    // load nodes in queue
    // if hierarchy expands, also load nodes from expanded hierarchy
    // once loaded, add data to this.points and remove node from queue
    // only evaluate 1-50 nodes per frame to maintain responsiveness *updateGenerator (): IterableIterator<boolean> {

    const maxNodesPerUpdate = 1;
    const intersectedNodes = [];

    for (let i = 0; i < Math.min(maxNodesPerUpdate, this.priorityQueue.size()); i++) {
      const element = this.priorityQueue.pop();
      if (!element) {
        continue; // Will never happen, but typescript wants it so...
      }
      const node: PointCloudOctreeGeometryNode = element.node;

      if (node.level > this.maxDepth) {
        continue;
      }

      if (node.loaded) {
        // add points to result
        intersectedNodes.push(node);
        this.lru.touch(node);
        this.highestLevelServed = Math.max(node.level, this.highestLevelServed);

        const geom = node.pcoGeometry;
        const hierarchyStepSize = geom ? geom.hierarchyStepSize : 1;

        const doTraverse = node.level === 0 || (node.level % hierarchyStepSize === 0 && node.hasChildren);

        if (doTraverse) {
          this.traverse(node);
        }
      } else {
        node.load();
        this.priorityQueue.push(element);
      }
    }
    if (intersectedNodes.length > 0) {
      for (const done of this.getPointsInsideProfile(intersectedNodes, this.temporaryResult)) {
        if (!done) {
          yield false;
        }
      }

      if (this.temporaryResult.size() > 100) {
        this.pointsServed += this.temporaryResult.size();
        this.callback.onProgress({ request: this, points: this.temporaryResult});
        this.temporaryResult = new ProfileData(this.profile);
      }
    }

    if (this.priorityQueue.size() === 0) {
      // done
      if (this.temporaryResult.size() > 0) {
        this.pointsServed += this.temporaryResult.size();
        this.callback.onProgress({ request: this, points: this.temporaryResult});
        this.temporaryResult = new ProfileData(this.profile);
      }

      this.callback.onFinish({ request: this });
      const index = this.pointcloud.profileRequests.indexOf(this);

      if (index >= 0) {
        this.pointcloud.profileRequests.splice(index, 1);
      }
    }

    yield true;
  }

  /*
   * We know the nodes intersect the profile box.
   * However not every point in the bounding box of the node is inside the profile,
   * in here, we accept only ones that are in.
   * */
  *getAccepted (
    numPoints: number,
    node: PointCloudOctreeGeometryNode,
    matrix: Matrix4,
    segment: ProfileSegment,
    segmentDir: Vector3,
    points: Points,
    totalMileage: number
  ): IterableIterator<boolean | [Uint32Array, Float64Array, Float32Array]> {
    if (!node.geometry) {
      return;
    }
    let checkpoint = performance.now();

    let accepted = new Uint32Array(numPoints);
    let mileage = new Float64Array(numPoints);
    let acceptedPositions = new Float32Array(numPoints * 3);
    let numAccepted = 0;

    const pos = new Vector3();
    const svp = new Vector3();
    const view = new Float32Array(node.geometry.attributes.position.array);

    for (let i = 0; i < numPoints; i++) {
      pos.set(
        view[i * 3 + 0],
        view[i * 3 + 1],
        view[i * 3 + 2]
      );

      pos.applyMatrix4(matrix);
      const distance = Math.abs(segment.cutPlane.distanceToPoint(pos));
      const centerDistance = Math.abs(segment.halfPlane.distanceToPoint(pos));

      if (distance < this.profile.width / 2 && centerDistance < segment.length / 2) {
        svp.subVectors(pos, segment.start);
        const localMileage = segmentDir.dot(svp);

        accepted[numAccepted] = i;
        mileage[numAccepted] = localMileage + totalMileage;
        points.boundingBox.expandByPoint(pos);

        acceptedPositions[3 * numAccepted + 0] = pos.x;
        acceptedPositions[3 * numAccepted + 1] = pos.y;
        acceptedPositions[3 * numAccepted + 2] = pos.z;

        numAccepted++;
      }

      if ((i % 1000) === 0) {
        const duration = performance.now() - checkpoint;

        if (duration > 4) {
          yield false;

          checkpoint = performance.now();
        }
      }
    }

    accepted = accepted.subarray(0, numAccepted);
    mileage = mileage.subarray(0, numAccepted);
    acceptedPositions = acceptedPositions.subarray(0, numAccepted * 3);

    yield [accepted, mileage, acceptedPositions];
  }

  *getPointsInsideProfile (nodes: PointCloudOctreeGeometryNode[], target: ProfileData): IterableIterator<boolean> {
    let checkpoint = performance.now();
    let totalMileage = 0;

    for (const segment of target.segments) {
      for (const node of nodes) {
        const numPoints = node.numPoints;
        const geometry = node.geometry;
        if (!geometry || !numPoints) {
          return;
        }

        const bbWorld = node.boundingBox.clone().applyMatrix4(this.pointcloud.matrixWorld);
        const bsWorld = bbWorld.getBoundingSphere(new Sphere());

        const start = new Vector3(segment.start.x, segment.start.y, bsWorld.center.z);
        const end = new Vector3(segment.end.x, segment.end.y, bsWorld.center.z);

        const closest = new Line3(start, end).closestPointToPoint(bsWorld.center, true, new Vector3());
        const distance = closest.distanceTo(bsWorld.center);

        const intersects = (distance < (bsWorld.radius + target.profile.width));

        if (!intersects) { // skip if current node does not intersect with current segment
          continue;
        }

        const sv = new Vector3().subVectors(segment.end, segment.start).setZ(0);
        const segmentDir = sv.clone().normalize();
        const points = new Points();
        // @ts-ignore // We know that Vector3.toArray ALWAYS returns an array with length 3
        const nodeMatrix = new Matrix4().makeTranslation(...node.boundingBox.min.toArray());
        const matrix = new Matrix4().multiplyMatrices(this.pointcloud.matrixWorld, nodeMatrix);

        let accepted = null;
        let mileage = null;
        let acceptedPositions = null;

        for (const result of this.getAccepted(numPoints, node, matrix, segment, segmentDir, points, totalMileage)) {
          if (!result) {
            yield false;
            checkpoint = performance.now();
          } else {
            // @ts-ignore
            [ accepted, mileage, acceptedPositions ] = result;
          }
        }

        const duration = performance.now() - checkpoint;
        if (duration > 4) {
          yield false;
          checkpoint = performance.now();
        }

        if (accepted === null || mileage === null || acceptedPositions === null) {
          return;
        }

        points.data.position = acceptedPositions;

        const relevantAttributes = Object.keys(geometry.attributes).filter(a => !['position', 'indices'].includes(a));

        for (const attributeName of relevantAttributes as Attribute[]) {
          const attribute = geometry.attributes[attributeName];
          const numElements = attribute.array.length / numPoints;

          if (numElements !== parseInt(`${numElements}`, 10)) {
            throw new Error('Yo something wrong happened');
          }

          const Type: any = attribute.array.constructor;

          const filteredBuffer = new Type(numElements * accepted.length);

          const source = attribute.array as Float32Array | Uint8Array; // position is Float32Array and indices is Uint8Array

          for (let i = 0; i < accepted.length; i++) {
            const index = accepted[i];
            const startIndex = index * numElements;
            const endIndex = startIndex + numElements;
            const sub = source.subarray(startIndex, endIndex);

            filteredBuffer.set(sub, i * numElements);
          }

          points.data[attributeName] = filteredBuffer;
        }

        points.data['mileage'] = mileage;
        points.numPoints = accepted.length;

        segment.points.add(points);
      }

      totalMileage += segment.length;
    }

    for (const segment of target.segments) {
      target.boundingBox.union(segment.points.boundingBox);
    }

    yield true;
  }

  finishLevelThenCancel(): void {
    if (this.cancelRequested) {
      return;
    }

    this.maxDepth = this.highestLevelServed;
    this.cancelRequested = true;
  }

  cancel(): void {
    this.callback.onCancel();

    this.priorityQueue = new BinaryHeap((x: any) => 1 / x.weight);
    const index = this.pointcloud.profileRequests.indexOf(this);
    if (index >= 0) {
      this.pointcloud.profileRequests.splice(index, 1);
    }
  }
}
