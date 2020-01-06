import { PointCloudOctree } from '../point-cloud-octree';
import { Profile } from './profile';
import { ProfileData, ProfileRequest } from './profile-request';

export class ProfileController {
  profile: Profile | null = null;
  numPoints: number = 0;
  threshold: number = 60 * 1000;
  scheduledRecomputeTime: number | null = null;
  requests: ProfileRequest[] = [];
  pointclouds: Set<PointCloudOctree> = new Set();

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
      console.log(segment.points.data);
    }
  }

  finishLevelThenCancel(): void {

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
}
