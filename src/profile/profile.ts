import {
  BoxGeometry,
  Color,
  Geometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  VertexColors
} from 'three';

let profileCounter = 0;
export class Profile extends Object3D {
  name: string;
  points: Vector3[] = [];
  edges: Line[] = [];
  spheres: Mesh[] = [];
  boxes: Mesh[] = [];
  width: number = 1;
  height: number = 20;
  _modifiable: boolean = true;
  sphereGeometry: SphereGeometry = new SphereGeometry(0.4, 10, 10);

  color: Color = new Color(0xff0000);
  lineColor: Color = new Color(0xff0000);

  constructor() {
    super();

    profileCounter += 1;
    this.name = `Profile#${profileCounter}`;

  }

  private createSphereMaterial(): MeshLambertMaterial {
    return new MeshLambertMaterial({
      color: 0xff0000,
      depthTest: false,
      depthWrite: false
    });
  }

  public addMarker(point: Vector3): void {
    this.points.push(point);

    const sphere = new Mesh(this.sphereGeometry, this.createSphereMaterial());
    this.add(sphere);
    this.spheres.push(sphere);

    if (this.points.length > 1) { // add edges and boxes
      const lineGeometry = new Geometry();
      lineGeometry.vertices.push(new Vector3(), new Vector3());
      lineGeometry.colors.push(this.lineColor, this.lineColor, this.lineColor);
      const lineMaterial = new LineBasicMaterial({
        vertexColors: VertexColors,
        linewidth: 2,
        transparent: true,
        opacity: 0.4
      });

      lineMaterial.depthTest = false;
      const edge = new Line(lineGeometry, lineMaterial);
      edge.visible = false;
      this.add(edge);
      this.edges.push(edge);

      const boxGeometry = new BoxGeometry(1, 1, 1);
      const boxMaterial = new MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.2});
      const box = new Mesh(boxGeometry, boxMaterial);
      box.visible = false;
      this.add(box);
      this.boxes.push(box);
    }

    // TODO listeners after inputhandler implemented

    const event = {
      type: 'marker_added',
      profile: this,
      sphere: sphere
    };

    this.dispatchEvent(event);
    this.setPosition(this.points.length - 1, point);
  }

  setPosition(index: number, position: Vector3): void {
    const point = this.points[index];

    point.copy(position);

    const event = {
      type: 'marker_moved',
      profile: this,
      index: index,
      position: point.clone()
    };

    this.dispatchEvent(event);
    this.update();
  }

  update(): void {
    if (this.points.length === 0) {
      return;
    } else if (this.points.length === 1) {
      const point = this.points[0];
      this.spheres[0].position.copy(point);
      return;
    }

    const min = this.points[0].clone();
    const max = this.points[0].clone();
    const centroid = new Vector3();
    const lastIndex = this.points.length - 1;
    for (let i = 0; i <= lastIndex; i++) {
      const point = this.points[i];
      const sphere = this.spheres[i];
      const leftIndex = (i === 0) ? lastIndex : i - 1;
      const leftVertex = this.points[leftIndex];
      const leftEdge = this.edges[leftIndex];
      const rightEdge = this.edges[i];
      const leftBox = this.boxes[leftIndex];

      sphere.position.copy(point);

      if (this._modifiable) {
        sphere.visible = true;
      } else {
        sphere.visible = false;
      }

      if (leftEdge) {
        const geometry = leftEdge.geometry as Geometry;
        geometry.vertices[1].copy(point);
        geometry.verticesNeedUpdate = true;
        geometry.computeBoundingSphere();
      }

      if (rightEdge) {
        const geometry = rightEdge.geometry as Geometry;
        geometry.vertices[0].copy(point);
        geometry.verticesNeedUpdate = true;
        geometry.computeBoundingSphere();
      }

      if (leftBox) {
        const start = leftVertex;
        const end = point;

        const length = start.clone().setZ(0).distanceTo(end.clone().setZ(0));
        leftBox.scale.set(length, 1000000, this.width);
        leftBox.up.set(0, 0, 1);

        const center = new Vector3().addVectors(start, end).multiplyScalar(0.5);
        const diff = new Vector3().subVectors(end, start);
        const target = new Vector3(diff.y, -diff.x, 0);

        leftBox.position.set(0, 0, 0);
        leftBox.lookAt(target);
        leftBox.position.copy(center);
      }

      centroid.add(point);
      min.min(point);
      max.max(point);
    }

    centroid.multiplyScalar(1 / this.points.length);

    for (const box of this.boxes) {
      box.position.z = min.z + (max.z - min.z) / 2;
    }
  }

}
