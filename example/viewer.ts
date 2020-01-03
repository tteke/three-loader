import { Box3, Box3Helper, Color,  Matrix4, PerspectiveCamera, Scene,  Vector3, WebGLRenderer } from 'three';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { PointCloudOctree, Potree } from '../src';

const computeTransformedBoundingBox = (box: Box3, transform: Matrix4) => {
  const vertices = [
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.min.x, box.max.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.min.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.min.y, box.max.z).applyMatrix4(transform),
    new Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(transform)
  ];

  const boundingBox = new Box3();

  boundingBox.setFromPoints(vertices);

  return boundingBox;
};

export class Viewer {
  /**
   * The element where we will insert our canvas.
   */
  private targetEl: HTMLElement | undefined;
  /**
   * The ThreeJS renderer used to render the scene.
   */
  private renderer = new WebGLRenderer();
  /**
   * Our scene which will contain the point cloud.
   */
  scene: Scene = new Scene();
  /**
   * The camera used to view the scene.
   */
  camera: PerspectiveCamera;
  /**
   * Controls which update the position of the camera.
   */
  cameraControls!: OrbitControls;
  /**
   * Out potree instance which handles updating point clouds, keeps track of loaded nodes, etc.
   */
  private potree = new Potree();
  /**
   * Array of point clouds which are in the scene and need to be updated.
   */
  private pointClouds: PointCloudOctree[] = [];
  /**
   * The time (milliseconds) when `loop()` was last called.
   */
  private prevTime: number | undefined;
  /**
   * requestAnimationFrame handle we can use to cancel the viewer loop.
   */
  private reqAnimationFrameHandle: number | undefined;

  constructor(width: number, height: number) {
    this.camera = new PerspectiveCamera(75, width / height, 0.1, 10000);
  }

  /**
   * Initializes the viewer into the specified element.
   *
   * @param targetEl
   *    The element into which we should add the canvas where we will render the scene.
   */
  initialize(targetEl: HTMLElement): void {
    if (this.targetEl || !targetEl) {
      return;
    }

    this.targetEl = targetEl;
    targetEl.appendChild(this.renderer.domElement);

    this.cameraControls = new OrbitControls(this.camera, this.targetEl);

    this.resize();
    window.addEventListener('resize', this.resize);

    requestAnimationFrame(this.loop);
  }

  /**
   * Performs any cleanup necessary to destroy/remove the viewer from the page.
   */
  destroy(): void {
    if (this.targetEl) {
      this.targetEl.removeChild(this.renderer.domElement);
      this.targetEl = undefined;
    }

    window.removeEventListener('resize', this.resize);

    // TODO: clean point clouds or other objects added to the scene.

    if (this.reqAnimationFrameHandle !== undefined) {
      cancelAnimationFrame(this.reqAnimationFrameHandle);
    }
  }

  /**
   * Loads a point cloud into the viewer and returns it.
   *
   * @param fileName
   *    The name of the point cloud which is to be loaded.
   * @param baseUrl
   *    The url where the point cloud is located and from where we should load the octree nodes.
   */
  load(fileName: string, baseUrl: string): Promise<PointCloudOctree> {
    return this.potree.loadPointCloud(
      // The file name of the point cloud which is to be loaded.
      fileName,
      // Given the relative URL of a file, should return a full URL.
      url => `${baseUrl}${url}`,
    );
  }

  add(pco: PointCloudOctree): void {
    this.scene.add(pco);
    this.pointClouds.push(pco);
  }

  unload(): void {
    this.pointClouds.forEach(pco => {
      this.scene.remove(pco);
      pco.dispose();
    });

    this.pointClouds = [];
  }

  fitToScreen(): void {
      // get bounding box
      const box = new Box3();
      this.scene.updateMatrixWorld();
      for (const pointCloud of this.pointClouds) {
        pointCloud.updateMatrixWorld(true);
        const pointCloudBox = pointCloud.pcoGeometry.tightBoundingBox ? pointCloud.pcoGeometry.tightBoundingBox : pointCloud.boundingBox;
        const boxWorld = computeTransformedBoundingBox(pointCloudBox, pointCloud.matrixWorld);
        box.union(boxWorld);
      }

      const boxobj = new Box3Helper(box, new Color(0xff0000));
      this.scene.add(boxobj);

      const size = new Vector3();
      box.getSize(size);
      const center = new Vector3();
      box.getCenter(center);

      const boxWidth = Math.max(size.x, size.y); // long edge of the box when viewed from top;

      const dist = boxWidth / 2 / Math.tan(Math.PI * this.camera.fov / 360);

      this.camera.lookAt(center);
      this.camera.position.copy(center);
      this.camera.rotation.order = 'ZYX';
      this.camera.position.z += dist;
      this.camera.updateProjectionMatrix();
      this.cameraControls.target = center;
      this.cameraControls.update();
  }

  /**
   * Updates the point clouds, cameras or any other objects which are in the scene.
   *
   * @param dt
   *    The time, in milliseconds, since the last update.
   */
  update(_: number): void {
    // Alternatively, you could use Three's OrbitControls or any other
    // camera control system.
    this.cameraControls.update();

    // This is where most of the potree magic happens. It updates the
    // visiblily of the octree nodes based on the camera frustum and it
    // triggers any loads/unloads which are necessary to keep the number
    // of visible points in check.
    this.potree.updatePointClouds(this.pointClouds, this.camera, this.renderer);
  }

  /**
   * Renders the scene into the canvas.
   */
  render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The main loop of the viewer, called at 60FPS, if possible.
   */
  loop = (time: number): void => {
    this.reqAnimationFrameHandle = requestAnimationFrame(this.loop);

    const prevTime = this.prevTime;
    this.prevTime = time;
    if (prevTime === undefined) {
      return;
    }

    this.update(time - prevTime);
    this.render();
  };

  /**
   * Triggered anytime the window gets resized.
   */
  resize = () => {
    if (!this.targetEl) {
      return;
    }

    const { width, height } = this.targetEl.getBoundingClientRect();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };
}
