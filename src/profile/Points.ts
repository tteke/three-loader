import { Box3 } from 'three';

type TypedArray = Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;
type Attributes = 'position' | 'color' | 'intensity' | 'classification' | 'returnNumber' | 'numberOfReturns' | 'pointSourceId';

type Data = {
  [A in Attributes]: TypedArray;
}

export class Points {
  boundingBox: Box3 = new Box3();
  numPoints: number = 0;
  data: Data = {
    position: new Float32Array(),
    color: new Uint8Array(),
    intensity: new Uint16Array(),
    classification: new Uint8Array(),
    returnNumber: new Uint8Array(),
    numberOfReturns: new Uint8Array(),
    pointSourceId: new Uint16Array()
  };

  add(points: Points) {
    const currentSize = this.numPoints;
    const additionalSize = points.numPoints
    const newSize = currentSize + additionalSize;

    const thisAttributes = Object.keys(this.data).filter(a => !!this.data[a as Attributes].length)
    const otherAttributes = Object.keys(points.data).filter(a => !!points.data[a as Attributes].length);
    const attributes = new Set([...thisAttributes, ...otherAttributes]);

    for (const attribute of Array.from(attributes.values()) as Attributes[]) {
      if (thisAttributes.includes(attribute) && otherAttributes.includes(attribute)) {
        const Type: any = this.data[attribute].constructor;
        const merged = new Type(this.data[attribute].length + points.data[attribute].length);
        merged.set(this.data[attribute], 0);
        merged.set(points.data[attribute], this.data[attribute].length);
        this.data[attribute] = merged;
      } else if (thisAttributes.includes(attribute) && !otherAttributes.includes(attribute)) {
        const elementsPerPoint = this.data[attribute].length / this.numPoints;
        const Type: any = this.data[attribute].constructor;
        const expanded = new Type(elementsPerPoint * newSize);
        expanded.set(this.data[attribute], 0);
        this.data[attribute] = expanded;
      } else {
        const elementsPerPoint = points.data[attribute].length / additionalSize;
        const Type: any = points.data[attribute].constructor;
        const expanded = new Type(elementsPerPoint * newSize);
        expanded.set(points.data[attribute], elementsPerPoint * currentSize);
        this.data[attribute] = expanded;
      }
    }

    this.numPoints = newSize;
    this.boundingBox.union(points.boundingBox);
  }
}
