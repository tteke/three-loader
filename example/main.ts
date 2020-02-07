import { Box3, Matrix4, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { PointCloudOctree, PointSizeType, Profile, ProfileController } from '../src';
import { Viewer } from './viewer';

require('./main.css');

const targetEl = document.createElement('div');
targetEl.className = 'container';
document.body.appendChild(targetEl);

const profileEl = document.createElement('div');
profileEl.className = 'profile-container';
document.body.appendChild(profileEl);

const { width, height } = targetEl.getBoundingClientRect();
console.log(width, height);

const viewer = new Viewer(width, height);
viewer.initialize(targetEl);

let pointCloud: PointCloudOctree | undefined;
let loaded: boolean = false;

const unloadBtn = document.createElement('button');
unloadBtn.textContent = 'Unload';
unloadBtn.addEventListener('click', () => {
  if (!loaded) {
    return;
  }

  viewer.unload();
  loaded = false;
  pointCloud = undefined;
});

const loadBtn = document.createElement('button');
loadBtn.textContent = 'Load';
loadBtn.addEventListener('click', () => {
  if (loaded) {
    return;
  }

  loaded = true;

  viewer
    .load(
      'cloud.js',
      'https://raw.githubusercontent.com/potree/potree/develop/pointclouds/vol_total/',
    )
    .then(pco => {
      pointCloud = pco;
      pointCloud.material.size = 1.0;
      pointCloud.material.pointSizeType = PointSizeType.ADAPTIVE;

      viewer.add(pco);

      viewer.fitToScreen();

      const controller = new ProfileController();

      controller.addPointcloud(pco);

      const { width: profileWidth, height: profileHeight } = profileEl.getBoundingClientRect();

      const profileRenderer = new WebGLRenderer({ alpha: true, premultipliedAlpha: false });
      profileRenderer.setClearColor(0x000000, 0);
      profileRenderer.setSize(profileWidth, profileHeight);
      profileRenderer.autoClear = true;

      const profileCamera = new OrthographicCamera(-1000, 1000, 1000, -1000, -1000, 1000);
      profileCamera.up.set(0, 0, 1);
      profileCamera.rotation.order = 'ZXY';
      profileCamera.rotation.x = Math.PI / 2.0;

      const profileScene = new Scene();
      profileScene.add(controller.pcRoot);

      profileRenderer.render(profileScene, profileCamera);

      controller.addEventListener('recomputed_segment', () => {
        controller.setScaleFromDimensions(profileWidth, profileHeight, profileCamera);
        profileRenderer.render(profileScene, profileCamera);
      });

      profileRenderer.render(profileScene, profileCamera);
      profileEl.appendChild(profileRenderer.domElement);
      profileRenderer.domElement.style.width = '100%';
      profileRenderer.domElement.style.height = '100%';

      const profile = new Profile();

      profile.setWidth(10);

      profile.addMarker(new Vector3(589997.02, 231327.75, 755.73));
      profile.addMarker(new Vector3(589579.65, 231323.51, 775.78));
      profile.addMarker(new Vector3(589500.87, 231356.23, 782.91));

      controller.setProfile(profile);

      profile.spheres.forEach(sphere => {
        viewer.scene.add(sphere);
      });

      const boxes = [];
      boxes.push(...profile.boxes);

      const clipBoxes = boxes.map( box => {
        box.updateMatrixWorld();
        const boxInverse = new Matrix4().getInverse(box.matrixWorld);
        const boxPosition = box.getWorldPosition(new Vector3());
        return {box: new Box3().setFromObject(box), matrix: box.matrixWorld, inverse: boxInverse, position: boxPosition};
      });

      // set clip volumes in material
      pco.material.setClipBoxes(clipBoxes);

    })
    .catch(err => console.error(err));
});

const slider = document.createElement('input');
slider.type = 'range';
slider.min = String(10_000);
slider.max = String(500_000);
slider.className = 'budget-slider';

const profileBtn = document.createElement('button');
profileBtn.textContent = 'profile';
profileBtn.addEventListener('click', () => {
  profileEl.classList.toggle('active');
});

slider.addEventListener('change', () => {
  if (!pointCloud) {
    return;
  }

  pointCloud.potree.pointBudget = parseInt(slider.value, 10);
  console.log(pointCloud.potree.pointBudget);
});

const btnContainer = document.createElement('div');
btnContainer.className = 'btn-container';
document.body.appendChild(btnContainer);
btnContainer.appendChild(unloadBtn);
btnContainer.appendChild(loadBtn);
btnContainer.appendChild(profileBtn);
btnContainer.appendChild(slider);
