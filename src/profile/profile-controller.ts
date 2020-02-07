import { Box3, BufferAttribute, BufferGeometry, EventDispatcher, Object3D, Points, TypedArray, Vector3, OrthographicCamera } from 'three';
import { PointCloudMaterial } from '../materials/point-cloud-material';
import { PointCloudOctree } from '../point-cloud-octree';
import { Points as PotreePoints } from './points';
import { Profile } from './profile';
import { ProfileData, ProfileRequest } from './profile-request';

type IBufferAttribute = BufferAttribute & { updateRange?: { offset?: number, count?: number } };
type IPoints = Points & { geometry: BufferGeometry };

const materialPool: Set<PointCloudMaterial> = new Set();

export const getMaterialInstance: () => (PointCloudMaterial) = () =>  {
    let instance = materialPool.values().next().value;
    if (!instance) {
      instance = new PointCloudMaterial();
    } else {
      materialPool.delete(instance);
    }

    return instance;
};

export const releaseMaterialInstance: (instance: PointCloudMaterial) => void = (instance) => {
  materialPool.add(instance);
};

export class ProfilePointCloudEntry {
  points: PotreePoints[] = [];
  material: PointCloudMaterial;
  sceneNode: Object3D = new Object3D();
  currentBatch: IPoints | null = null;
  projectedBox: Box3 = new Box3();

  constructor() {
    const material = getMaterialInstance();
    material.uniforms.minSize.value = 2;
    material.uniforms.maxSize.value = 2;
    material.opacity = 1.0;
    this.material = material;
  }

  dispose(): void {
    for (const child of this.sceneNode.children as Points[]) {
      releaseMaterialInstance(child.material as PointCloudMaterial);
      child.geometry.dispose();
    }

    this.sceneNode.children.length = 0;
  }

  addPoints(points: PotreePoints): void {
    this.points.push(points);

    const batchSize = 10 * 1000;

    const createNewBatch = () => {
      const geo = new BufferGeometry();

      const buffer = {
        position: new Float32Array(3 * batchSize),
        color: new Uint8Array(4 * batchSize),
        intensity: new Uint16Array(batchSize),
        classification: new Uint8Array(batchSize),
        returnNumber: new Uint8Array(batchSize),
        numberOfReturns: new Uint8Array(batchSize),
        pointSourceID: new Uint16Array(batchSize)
      };

      geo.setAttribute('position', new BufferAttribute(buffer.position, 3));
      geo.setAttribute('color', new BufferAttribute(buffer.color, 4, true));
      geo.setAttribute('intensity', new BufferAttribute(buffer.intensity, 1, false));
      geo.setAttribute('classification', new BufferAttribute(buffer.classification, 1, false));
      geo.setAttribute('returnNumber', new BufferAttribute(buffer.returnNumber, 1, false));
      geo.setAttribute('numberOfReturns', new BufferAttribute(buffer.numberOfReturns, 1, false));
      geo.setAttribute('pointSourceID', new BufferAttribute(buffer.pointSourceID, 1, false));

      geo.drawRange.start = 0;
      geo.drawRange.count = 0;

      this.currentBatch = new Points(geo, this.material) as IPoints;
      this.sceneNode.add(this.currentBatch);
    };

    if (!this.currentBatch) {
      createNewBatch();
    }

    const updateRange = {
      start: this.currentBatch!.geometry.drawRange.count || 0,
      count: 0
    };

    const projectedBox = new Box3();

    for (let i = 0; i < points.numPoints; i++) {
      if (updateRange.start + updateRange.count >= batchSize && this.currentBatch) {
        // finalize, move onto next abatch
        for (const key of Object.keys(this.currentBatch.geometry.attributes)) {
          const attribute: IBufferAttribute = this.currentBatch.geometry.attributes[key] as BufferAttribute;
          attribute.updateRange = {
            offset: updateRange.start,
            count: updateRange.count
          };
          attribute.needsUpdate = true;
        }
        this.currentBatch.geometry.computeBoundingBox();
        this.currentBatch.geometry.computeBoundingSphere();

        createNewBatch();
        updateRange.start = 0, updateRange.count = 0;
      }

      const x = points.data.mileage[i];
      const y = 0;
      const z = points.data.position[3 * i + 2];

      if (z < 700) {
        console.log(z);
      }

      projectedBox.expandByPoint(new Vector3(x, y, z));
      const currentIndex = updateRange.start + updateRange.count;
      const attributes = this.currentBatch!.geometry.attributes;

      (attributes.position.array as TypedArray).set([x, y, z], currentIndex * 3);

      if (points.data.color) {
        (attributes.color.array as TypedArray).set([
          points.data.color[4 * i + 0],
          points.data.color[4 * i + 1],
          points.data.color[4 * i + 2],
          255
        ], currentIndex * 4);
      }

      if (points.data.intensity) {
        (attributes.intensity.array as TypedArray).set([points.data.intensity[i]], currentIndex);
      }

      if (points.data.classification) {
        (attributes.classification.array as TypedArray).set([points.data.classification[i]], currentIndex);
      }

      if (points.data.returnNumber) {
        (attributes.returnNumber.array as TypedArray).set([points.data.returnNumber[i]], currentIndex);
      }

      if (points.data.numberOfReturns) {
        (attributes.numberOfReturns.array as TypedArray).set([points.data.numberOfReturns[i]], currentIndex);
      }

      if (points.data.pointSourceID) {
        (attributes.pointSourceID.array as TypedArray).set([points.data.pointSourceID[i]], currentIndex);
      }

      updateRange.count++;
      this.currentBatch!.geometry.drawRange.count++;
    }

    for (const key of Object.keys(this.currentBatch!.geometry.attributes)) {
      const attribute: IBufferAttribute = this.currentBatch!.geometry.attributes[key] as BufferAttribute;
      attribute.updateRange.offset = updateRange.start;
      attribute.updateRange.count = updateRange.count;
      attribute.needsUpdate = true;
    }

    points.projectedBox = projectedBox;
    this.projectedBox = this.points.reduce((a, i) => a.union(i.projectedBox), new Box3());
  }
}

export class ProfileController extends EventDispatcher {
  profile: Profile | null = null;
  numPoints: number = 0;
  threshold: number = 60 * 1000;
  scheduledRecomputeTime: number | null = null;
  requests: ProfileRequest[] = [];
  pointclouds: Set<PointCloudOctree> = new Set();
  profilePCEntries: Map<PointCloudOctree, ProfilePointCloudEntry> = new Map();
  pcRoot: Object3D = new Object3D();
  projectedBox: Box3 = new Box3();
  renderTriggerListeners: Set<Function> = new Set();
  progressListeners: Set<Function> = new Set();
  scale: Vector3 = new Vector3(1, 1, 1);

  setProfile(profile: Profile): void {
    if (this.profile !== null && this.profile !== profile) {
      this.profile.removeEventListener('marker_moved', this.recompute);
      this.profile.removeEventListener('marker_added', this.recompute);
      this.profile.removeEventListener('marker_removed', this.recompute);
      this.profile.removeEventListener('width_changed', this.recompute);
    }

    this.profile = profile;

    this.profile.removeEventListener('marker_moved', this.recompute);
    this.profile.removeEventListener('marker_added', this.recompute);
    this.profile.removeEventListener('marker_removed', this.recompute);
    this.profile.removeEventListener('width_changed', this.recompute);

    this.recompute();
  }

  addPointcloud(pointcloud: PointCloudOctree): void {
    if (this.pointclouds.has(pointcloud)) {
      return;
    }

    this.pointclouds.add(pointcloud);
    this.recompute();
  }

  removePointcloud(pointcloud: PointCloudOctree): void {
    if (this.pointclouds.has(pointcloud)) {
      this.pointclouds.delete(pointcloud);
    }
  }

  reset (): void {
    this.numPoints = 0;

    if (this.profile) {
      for (const request of this.requests) {
        request.cancel();
      }
    }
  }

  progressHandler(pointcloud: PointCloudOctree, progress: ProfileData): void {
    pointcloud.visible = true;

    for (const segment of progress.segments) {
      let entry = this.profilePCEntries.get(pointcloud);

      if (!entry) {
        entry = new ProfilePointCloudEntry();
        this.profilePCEntries.set(pointcloud, entry);
      }

      entry.addPoints(segment.points);

      this.pcRoot.add(entry.sceneNode);
      this.projectedBox.union(entry.projectedBox);
      this.dispatchEvent({
        type: 'recomputed_segment',
        segment: segment
      });
    }

    this.dispatchEvent({
      type: 'recompute_finished'
    });
  }

  setScaleFromDimensions(width: number, height: number, camera?: OrthographicCamera): void{
    const sx = width / Math.abs(this.projectedBox.max.x - this.projectedBox.min.x);
    const sy = height / Math.abs(this.projectedBox.max.z - this.projectedBox.min.z);
    const scale = Math.min(sx, sy);

    const center = this.projectedBox.getCenter(new Vector3());
    this.scale.set(scale, scale, 1);

    if (camera) {
      camera.position.copy(center);
      camera.left = (-width / 2) * this.scale.x;
      camera.right = (+width / 2) * this.scale.x;
      camera.top = (+height / 2) * this.scale.y;
      camera.bottom = (-height / 2) * this.scale.y;
      camera.updateProjectionMatrix();
    }
  }

  addRenderTriggerListener(fn: Function): void {
    this.renderTriggerListeners.add(fn);
  }

  removeRenderTriggerListner(fn: Function): void {
    if (this.renderTriggerListeners.has(fn)) {
      this.renderTriggerListeners.delete(fn);
    }
  }

  addProgressListener(fn: Function): void {
    this.progressListeners.add(fn);
  }

  removeProgressListener(fn: Function): void {
    if (this.progressListeners.has(fn)) {
      this.progressListeners.delete(fn);
    }
  }

  finishLevelThenCancel(): void {
    for (const request of this.requests) {
      request.finishLevelThenCancel();
    }

    this.requests = [];
  }

  recompute(): void {
    if (!this.profile) {
      return;
    }

    if (this.scheduledRecomputeTime !== null && this.scheduledRecomputeTime > new Date().getTime()) {
      return;
    } else {
      this.scheduledRecomputeTime = new Date().getTime() + 100;
    }
    this.scheduledRecomputeTime = null;

    this.reset();

    for (const pointcloud of Array.from(this.pointclouds).filter(pco => pco.visible)) {
      const request = pointcloud.getPointsInsideProfile(this.profile, null, {
        onProgress: (event: { request: ProfileRequest, points: ProfileData }) => {
          this.progressHandler(pointcloud, event.points);

          if (this.numPoints > this.threshold) {
            this.finishLevelThenCancel();
          }
        },
        onFinish: (event: { request: ProfileRequest }) => {
          console.log('finished', event);
        },
        onCancel: () => {
          console.log('cancelled');
        }
      });

      this.requests.push(request);
    }
  }

  render(): void {
    // for (const [pointcloud, entry] of this.profilePCEntries) {
      // const material = entry.material;

      // material.uniforms.uColor = pointcloud.material.uniforms.uColor;
      // material.uniforms.intensityRange.value = pointcloud.material.uniforms.intensityRange.value;
      // material.elevationRange = pointcloud.material.elevationRange;

      // material.rgbGamma = pointcloud.material.rgbGamma;
      // material.rgbContrast = pointcloud.material.rgbContrast;
      // material.rgbBrightness = pointcloud.material.rgbBrightness;

      // material.intensityRange = pointcloud.material.intensityRange;
      // material.intensityGamma = pointcloud.material.intensityGamma;
      // material.intensityContrast = pointcloud.material.intensityContrast;
      // material.intensityBrightness = pointcloud.material.intensityBrightness;

      // material.uniforms.wRGB.value = pointcloud.material.uniforms.wRGB.value;
      // material.uniforms.wIntensity.value = pointcloud.material.uniforms.wIntensity.value;
      // material.uniforms.wElevation.value = pointcloud.material.uniforms.wElevation.value;
      // material.uniforms.wClassification.value = pointcloud.material.uniforms.wClassification.value;
      // material.uniforms.wReturnNumber.value = pointcloud.material.uniforms.wReturnNumber.value;
      // material.uniforms.wSourceID.value = pointcloud.material.uniforms.wSourceID.value;

      // material.classification = pointcloud.material.classification;
      // material.uniforms.classificationLUT.value.image.data = pointcloud.material.uniforms.classificationLUT.value.image.data;
    // }

    for (const listener of this.renderTriggerListeners) {
      listener();
    }
  }
}
