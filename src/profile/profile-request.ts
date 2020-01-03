import { Box3, Matrix4, Plane, Vector3 } from 'three';
import { PointCloudOctree, PointCloudOctreeGeometryNode } from '../';
import { BinaryHeap } from '../utils/binary-heap';
import { Points, Profile } from './';

export interface ProfileSegment {
  start: Vector3;
  end: Vector3;
  cutPlane: Plane;
  halfPlane: Plane;
  length: number;
  points: Points;
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

type ProfileRequestCallback = {
  onProgress: Function,
  onCancel: Function,
  onFinished: Function
};

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

  *updateGenerator (): IterableIterator<boolean> {
    // TODO
    yield true;
  }

  *getAccepted (
    numPoints: number,
    node: PointCloudOctreeGeometryNode,
    matrix: Matrix4,
    segment: ProfileSegment,
    segmentDir: Vector3,
    points: Points,
    totalMileage: number
  ): IterableIterator<boolean | [Uint32Array, Float64Array, Float32Array]> {
    // TODO
    console.log(numPoints, node, matrix, segment, segmentDir, points, totalMileage);
    yield true;
  }

  *getPointsInsideProfile (nodes: PointCloudOctreeGeometryNode[], target: ProfileData): IterableIterator<boolean> {
    // TODO
    console.log(nodes, target);

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
