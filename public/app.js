import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// State
let config = { user: '', mailbox: '', avatar: null };
let messages = []; // Messages TO user (for main panel)
let allMessages = []; // All messages involving user (for desk dialogs)
let recipients = [];
let avatarStates = {}; // Map of name -> {tool_name, timestamp}
let scene, camera, renderer, controls;
let agentMeshes = new Map();
let connectionLines = [];
let raycaster, mouse;

// Color palette for agents - modern muted tones
const agentColors = [
  0x5EEAD4, 0x6EE7B7, 0x7DD3FC, 0xA78BFA, 0xFBBF24,
  0xF9A8D4, 0x86EFAC, 0x93C5FD, 0xC4B5FD, 0x67E8F9
];

function getAgentColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return agentColors[Math.abs(hash) % agentColors.length];
}

// Platform dimensions
const PLATFORM_SIZE = 60;
const PLATFORM_HEIGHT = 2;
const WALL_HEIGHT = 18;

// Animated objects
let holoSphere = null;
let holoParticles = null;
let glowLights = [];
let floatingParticles = [];
let composer = null;
let waterMesh = null;

// Initialize Three.js
function init() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a3a3a);
    scene.fog = new THREE.FogExp2(0x1a3a3a, 0.003);
    
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(55, 45, 55);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 25;
    controls.maxDistance = 120;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;
    controls.target.set(0, 5, 0);
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };
    
    // === Lighting ===
    // Soft ambient
    const ambientLight = new THREE.AmbientLight(0x2d5a5a, 0.8);
    scene.add(ambientLight);
    
    // Main directional light (warm)
    const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.6);
    dirLight.position.set(40, 80, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -40;
    dirLight.shadow.camera.right = 40;
    dirLight.shadow.camera.top = 40;
    dirLight.shadow.camera.bottom = -40;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);
    
    // Fill light from below (teal tint)
    const fillLight = new THREE.DirectionalLight(0x4fd1c5, 0.3);
    fillLight.position.set(-20, 5, -20);
    scene.add(fillLight);
    
    // Hemisphere light for natural ambient
    const hemiLight = new THREE.HemisphereLight(0x4fd1c5, 0x1a3a3a, 0.4);
    scene.add(hemiLight);
    
    // Additional accent lights for bloom effect
    // Center glow from holographic sphere area
    const centerGlow = new THREE.PointLight(0x4fd1c5, 0.6, 50);
    centerGlow.position.set(0, PLATFORM_HEIGHT + 15, 0);
    scene.add(centerGlow);
    
    // Edge accent lights
    const edgeLight1 = new THREE.PointLight(0x88ffdd, 0.4, 30);
    edgeLight1.position.set(30, PLATFORM_HEIGHT + 10, 30);
    scene.add(edgeLight1);
    
    const edgeLight2 = new THREE.PointLight(0x88ffdd, 0.4, 30);
    edgeLight2.position.set(-30, PLATFORM_HEIGHT + 10, -30);
    scene.add(edgeLight2);
    
    // === Platform ===
    createPlatform();
    
    // === Reflective Water Surface ===
    createReflectiveWater();
    
    // === Glass Walls ===
    createGlassWalls();
    
    // === Decorative Plants ===
    createPlants();
    
    // === Holographic Sphere ===
    createHolographicSphere();
    
    // === Ambient Glow Lights ===
    createGlowLights();
    
    // === Floating Particles ===
    createFloatingParticles();
    
    // === Background Stars ===
    createBackgroundStars();
    
    window.addEventListener('resize', onWindowResize);
    
    // Raycaster for desk clicks
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('click', onDeskClick);
    
    // Add touch support for mobile
    renderer.domElement.addEventListener('touchstart', onDeskTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchend', onDeskTouchEnd, { passive: false });
    
    // Disable context menu on mobile for better UX
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Handle orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(onWindowResize, 100);
    });
    
    // === Post Processing ===
    setupPostProcessing();
    
    animate();
}

function createPlatform() {
    // Main platform - dark concrete slab
    const platformGeo = new THREE.BoxGeometry(PLATFORM_SIZE, PLATFORM_HEIGHT, PLATFORM_SIZE);
    const platformMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        roughness: 0.4,
        metalness: 0.1
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = PLATFORM_HEIGHT / 2;
    platform.receiveShadow = true;
    platform.castShadow = true;
    scene.add(platform);
    
    // Edge trim - lighter accent
    const trimGeo = new THREE.BoxGeometry(PLATFORM_SIZE + 0.5, 0.3, PLATFORM_SIZE + 0.5);
    const trimMat = new THREE.MeshStandardMaterial({
        color: 0x5a5a5a,
        roughness: 0.3,
        metalness: 0.3
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = PLATFORM_HEIGHT + 0.15;
    scene.add(trim);
    
    // Floor surface - polished concrete with subtle grid
    const floorGeo = new THREE.PlaneGeometry(PLATFORM_SIZE - 2, PLATFORM_SIZE - 2);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        roughness: 0.2,
        metalness: 0.15
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = PLATFORM_HEIGHT + 0.02;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Subtle grid on floor
    const gridHelper = new THREE.GridHelper(PLATFORM_SIZE - 4, 20, 0x555555, 0x444444);
    gridHelper.position.y = PLATFORM_HEIGHT + 0.05;
    gridHelper.material.opacity = 0.15;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
    
    // Ground below platform (dark reflection surface)
    const groundGeo = new THREE.PlaneGeometry(300, 300);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x1a3a3a,
        roughness: 0.6,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);
}

function createReflectiveWater() {
    // Reflective water surface below the platform
    const waterSize = PLATFORM_SIZE * 1.5;
    const waterGeo = new THREE.PlaneGeometry(waterSize, waterSize, 64, 64);
    
    // Create a custom shader material for reflective water effect
    const waterMat = new THREE.MeshPhysicalMaterial({
        color: 0x0d3333,
        metalness: 0.9,
        roughness: 0.1,
        transparent: true,
        opacity: 0.85,
        transmission: 0.3,
        thickness: 0.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide
    });
    
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = -0.5;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
    
    // Add subtle ripple effect using vertex displacement
    const positions = waterMesh.geometry.attributes.position;
    const initialPositions = positions.array.slice();
    waterMesh.userData.initialPositions = initialPositions;
    waterMesh.userData.ripplePhase = 0;
}

function setupPostProcessing() {
    // Setup EffectComposer for bloom
    composer = new EffectComposer(renderer);
    
    // Add render pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Add bloom pass
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.8,  // strength
        0.4,  // radius
        0.75  // threshold
    );
    composer.addPass(bloomPass);
}

function createGlassWalls() {
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x88cccc,
        transparent: true,
        opacity: 0.08,
        roughness: 0.05,
        metalness: 0.0,
        transmission: 0.95,
        thickness: 0.5,
        side: THREE.DoubleSide
    });
    
    const wallHeight = WALL_HEIGHT;
    const wallY = PLATFORM_HEIGHT + wallHeight / 2;
    const halfSize = PLATFORM_SIZE / 2;
    
    // Back wall
    const backWall = new THREE.Mesh(
        new THREE.PlaneGeometry(PLATFORM_SIZE, wallHeight),
        glassMat
    );
    backWall.position.set(0, wallY, -halfSize);
    scene.add(backWall);
    
    // Left wall
    const leftWall = new THREE.Mesh(
        new THREE.PlaneGeometry(PLATFORM_SIZE, wallHeight),
        glassMat
    );
    leftWall.position.set(-halfSize, wallY, 0);
    leftWall.rotation.y = Math.PI / 2;
    scene.add(leftWall);
    
    // Right wall (partial, for openness)
    const rightWall = new THREE.Mesh(
        new THREE.PlaneGeometry(PLATFORM_SIZE, wallHeight),
        glassMat
    );
    rightWall.position.set(halfSize, wallY, 0);
    rightWall.rotation.y = -Math.PI / 2;
    scene.add(rightWall);
    
    // Glass edge frames (vertical pillars at corners)
    const pillarGeo = new THREE.BoxGeometry(0.5, wallHeight, 0.5);
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x777777,
        roughness: 0.2,
        metalness: 0.6
    });
    
    const corners = [
        [-halfSize, wallY, -halfSize],
        [halfSize, wallY, -halfSize],
        [-halfSize, wallY, halfSize],
        [halfSize, wallY, halfSize]
    ];
    
    corners.forEach(pos => {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(...pos);
        pillar.castShadow = true;
        scene.add(pillar);
    });
    
    // Top edge frame
    const topFrameMat = new THREE.MeshStandardMaterial({
        color: 0x666666,
        roughness: 0.2,
        metalness: 0.5
    });
    
    const frameY = PLATFORM_HEIGHT + wallHeight;
    
    // Back top frame
    const backFrame = new THREE.Mesh(new THREE.BoxGeometry(PLATFORM_SIZE, 0.3, 0.3), topFrameMat);
    backFrame.position.set(0, frameY, -halfSize);
    scene.add(backFrame);
    
    // Left top frame
    const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, PLATFORM_SIZE), topFrameMat);
    leftFrame.position.set(-halfSize, frameY, 0);
    scene.add(leftFrame);
    
    // Right top frame
    const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, PLATFORM_SIZE), topFrameMat);
    rightFrame.position.set(halfSize, frameY, 0);
    scene.add(rightFrame);
}

function createPlants() {
    const plantPositions = [
        // Corner clusters
        [-25, PLATFORM_HEIGHT, -25],
        [25, PLATFORM_HEIGHT, -25],
        [-25, PLATFORM_HEIGHT, 25],
        [25, PLATFORM_HEIGHT, 25],
        // Edge accents
        [-20, PLATFORM_HEIGHT, 27],
        [20, PLATFORM_HEIGHT, 27],
        [-27, PLATFORM_HEIGHT, 0],
        [27, PLATFORM_HEIGHT, -15],
    ];
    
    plantPositions.forEach(pos => {
        createPlantCluster(pos[0], pos[1], pos[2]);
    });
}

function createPlantCluster(x, y, z) {
    const group = new THREE.Group();
    
    // Planter box
    const planterGeo = new THREE.BoxGeometry(3, 1.5, 3);
    const planterMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.6,
        metalness: 0.1
    });
    const planter = new THREE.Mesh(planterGeo, planterMat);
    planter.position.y = 0.75;
    planter.castShadow = true;
    planter.receiveShadow = true;
    group.add(planter);
    
    // Soil
    const soilGeo = new THREE.BoxGeometry(2.6, 0.2, 2.6);
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
    const soil = new THREE.Mesh(soilGeo, soilMat);
    soil.position.y = 1.5;
    group.add(soil);
    
    // Foliage - multiple spheres for bush look
    const leafColors = [0x1a6b3a, 0x228B22, 0x2d8b4e, 0x1f7a3f];
    
    for (let i = 0; i < 5; i++) {
        const size = 0.6 + Math.random() * 0.8;
        const leafGeo = new THREE.SphereGeometry(size, 8, 8);
        const leafMat = new THREE.MeshStandardMaterial({
            color: leafColors[Math.floor(Math.random() * leafColors.length)],
            roughness: 0.8
        });
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(
            (Math.random() - 0.5) * 1.5,
            1.8 + Math.random() * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        leaf.castShadow = true;
        group.add(leaf);
    }
    
    // Tall fern-like elements (cone shapes)
    for (let i = 0; i < 3; i++) {
        const fernGeo = new THREE.ConeGeometry(0.3, 2 + Math.random() * 2, 6);
        const fernMat = new THREE.MeshStandardMaterial({
            color: 0x1a5c2e,
            roughness: 0.7
        });
        const fern = new THREE.Mesh(fernGeo, fernMat);
        fern.position.set(
            (Math.random() - 0.5) * 1.5,
            2.5 + Math.random() * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        fern.castShadow = true;
        group.add(fern);
    }
    
    group.position.set(x, y, z);
    scene.add(group);
}

function createHolographicSphere() {
    // Wireframe sphere
    const sphereGeo = new THREE.IcosahedronGeometry(6, 3);
    const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x4fd1c5,
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    holoSphere = new THREE.Mesh(sphereGeo, sphereMat);
    holoSphere.position.set(0, PLATFORM_HEIGHT + 12, 0);
    scene.add(holoSphere);
    
    // Inner glow sphere
    const innerGeo = new THREE.SphereGeometry(4, 32, 32);
    const innerMat = new THREE.MeshBasicMaterial({
        color: 0x4fd1c5,
        transparent: true,
        opacity: 0.05
    });
    const innerSphere = new THREE.Mesh(innerGeo, innerMat);
    holoSphere.add(innerSphere);
    
    // Point cloud on sphere surface
    const particleCount = 300;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 5.5 + Math.random() * 0.5;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }
    
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
        color: 0x88ffee,
        size: 0.15,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    holoParticles = new THREE.Points(particleGeo, particleMat);
    holoSphere.add(holoParticles);
    
    // Point light from the sphere
    const sphereLight = new THREE.PointLight(0x4fd1c5, 0.8, 35);
    sphereLight.position.copy(holoSphere.position);
    scene.add(sphereLight);
}

function createGlowLights() {
    // Floor-standing lamp posts
    const lampPositions = [
        [20, PLATFORM_HEIGHT, 15],
        [-20, PLATFORM_HEIGHT, 15],
        [20, PLATFORM_HEIGHT, -20],
        [-20, PLATFORM_HEIGHT, -20],
    ];
    
    lampPositions.forEach(pos => {
        // Lamp post
        const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 8);
        const postMat = new THREE.MeshStandardMaterial({
            color: 0x555555,
            roughness: 0.3,
            metalness: 0.7
        });
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(pos[0], pos[1] + 3, pos[2]);
        post.castShadow = true;
        scene.add(post);
        
        // Lamp bulb
        const bulbGeo = new THREE.SphereGeometry(0.4, 16, 16);
        const bulbMat = new THREE.MeshBasicMaterial({
            color: 0xffcc66,
            transparent: true,
            opacity: 0.9
        });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(pos[0], pos[1] + 6.2, pos[2]);
        scene.add(bulb);
        
        // Point light
        const light = new THREE.PointLight(0xffcc66, 0.5, 18);
        light.position.set(pos[0], pos[1] + 6.2, pos[2]);
        light.castShadow = false;
        scene.add(light);
        glowLights.push({ bulb, light, baseIntensity: 0.5 });
    });
}

function createFloatingParticles() {
    const particleCount = 80;
    const positions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * PLATFORM_SIZE;
        positions[i * 3 + 1] = PLATFORM_HEIGHT + 2 + Math.random() * WALL_HEIGHT;
        positions[i * 3 + 2] = (Math.random() - 0.5) * PLATFORM_SIZE;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
        color: 0x88ffdd,
        size: 0.12,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
    });
    
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    floatingParticles.push(particles);
}

function createBackgroundStars() {
    // Distant stars/sparkles in the background
    const starCount = 200;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    
    for (let i = 0; i < starCount; i++) {
        // Place stars far outside the platform
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const radius = 100 + Math.random() * 150;
        
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = 20 + Math.random() * 100;
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        
        sizes[i] = 0.5 + Math.random() * 1.5;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const material = new THREE.PointsMaterial({
        color: 0xaaddff,
        size: 1.0,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });
    
    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
    
    // Animate stars with twinkle effect
    stars.userData.twinklePhase = Math.random() * Math.PI * 2;
    
    // Add to floatingParticles for animation
    floatingParticles.push(stars);
}

function createAgentDesk(name, position, toolName = null) {
    const color = getAgentColor(name);
    const group = new THREE.Group();
    group.position.copy(position);
    group.position.y = PLATFORM_HEIGHT;
    
    // Modern desk - white top with thin legs
    const deskTopGeo = new THREE.BoxGeometry(5, 0.2, 3);
    const deskMat = new THREE.MeshStandardMaterial({
        color: 0xe8e8e8,
        roughness: 0.3,
        metalness: 0.1
    });
    const deskTop = new THREE.Mesh(deskTopGeo, deskMat);
    deskTop.position.y = 2.5;
    deskTop.castShadow = true;
    deskTop.receiveShadow = true;
    group.add(deskTop);
    
    // Desk legs - thin metal
    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.4, 8);
    const legMat = new THREE.MeshStandardMaterial({
        color: 0x999999,
        roughness: 0.2,
        metalness: 0.7
    });
    const legPositions = [
        [-2.2, 1.2, -1.2],
        [2.2, 1.2, -1.2],
        [-2.2, 1.2, 1.2],
        [2.2, 1.2, 1.2]
    ];
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        group.add(leg);
    });
    
    // Modern chair - sleek
    const chairSeatGeo = new THREE.BoxGeometry(1.8, 0.15, 1.8);
    const chairMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.5,
        metalness: 0.2
    });
    const chairSeat = new THREE.Mesh(chairSeatGeo, chairMat);
    chairSeat.position.set(0, 1.6, 3.2);
    chairSeat.castShadow = true;
    group.add(chairSeat);
    
    // Chair back - curved look (box approximation)
    const chairBackGeo = new THREE.BoxGeometry(1.8, 2.2, 0.15);
    const chairBack = new THREE.Mesh(chairBackGeo, chairMat);
    chairBack.position.set(0, 2.7, 4.1);
    chairBack.castShadow = true;
    group.add(chairBack);
    
    // Chair post
    const chairPostGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8);
    const chairPost = new THREE.Mesh(chairPostGeo, legMat);
    chairPost.position.set(0, 0.9, 3.2);
    group.add(chairPost);
    
    // Chair base star
    for (let i = 0; i < 5; i++) {
        const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6);
        const arm = new THREE.Mesh(armGeo, legMat);
        const angle = (i / 5) * Math.PI * 2;
        arm.rotation.z = Math.PI / 2;
        arm.position.set(
            Math.cos(angle) * 0.5,
            0.3,
            3.2 + Math.sin(angle) * 0.5
        );
        arm.rotation.y = angle;
        group.add(arm);
    }
    
    // Person - Body (sitting, modern look)
    const bodyGeo = new THREE.CylinderGeometry(0.6, 0.5, 2, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.6,
        metalness: 0.05
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 2.7, 3.2);
    body.castShadow = true;
    group.add(body);
    
    // Person - Head
    const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
        color: 0xf5d0b0,
        roughness: 0.7
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 4.0, 3.2);
    head.castShadow = true;
    group.add(head);
    
    // Person - Arms on desk
    const armObjGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6);
    const armMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 });
    
    const leftArm = new THREE.Mesh(armObjGeo, armMat);
    leftArm.rotation.z = Math.PI / 2;
    leftArm.rotation.y = 0.3;
    leftArm.position.set(-0.8, 2.8, 2);
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armObjGeo, armMat);
    rightArm.rotation.z = Math.PI / 2;
    rightArm.rotation.y = -0.3;
    rightArm.position.set(0.8, 2.8, 2);
    group.add(rightArm);
    
    // Monitor (modern flat screen)
    const monitorStandGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 16);
    const monitorMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.3,
        metalness: 0.5
    });
    const monitorStand = new THREE.Mesh(monitorStandGeo, monitorMat);
    monitorStand.position.set(0, 2.65, 0.8);
    group.add(monitorStand);
    
    const monitorNeckGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);
    const monitorNeck = new THREE.Mesh(monitorNeckGeo, monitorMat);
    monitorNeck.position.set(0, 3.2, 0.8);
    group.add(monitorNeck);
    
    // Screen
    const screenFrameGeo = new THREE.BoxGeometry(3, 1.8, 0.12);
    const screenFrame = new THREE.Mesh(screenFrameGeo, monitorMat);
    screenFrame.position.set(0, 4.0, 0.8);
    screenFrame.castShadow = true;
    group.add(screenFrame);
    
    // Screen display (glowing)
    const screenDisplayGeo = new THREE.PlaneGeometry(2.7, 1.5);
    const screenDisplayMat = new THREE.MeshBasicMaterial({
        color: 0x2a6b5e,
    });
    const screenDisplay = new THREE.Mesh(screenDisplayGeo, screenDisplayMat);
    screenDisplay.position.set(0, 4.0, 0.87);
    group.add(screenDisplay);
    
    // Screen glow light
    const screenLight = new THREE.PointLight(0x4fd1c5, 0.3, 6);
    screenLight.position.set(0, 4.0, 1.5);
    group.add(screenLight);
    
    // Keyboard
    const kbGeo = new THREE.BoxGeometry(1.6, 0.05, 0.5);
    const kbMat = new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.5,
        metalness: 0.3
    });
    const keyboard = new THREE.Mesh(kbGeo, kbMat);
    keyboard.position.set(0, 2.63, 2);
    group.add(keyboard);
    
    // Name label sprite
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const scale = 2;
    canvas.width = 512;
    canvas.height = toolName ? 160 : 128;
    context.scale(scale, scale);
    
    // Frosted glass background
    context.fillStyle = 'rgba(20, 60, 60, 0.85)';
    context.roundRect(0, 0, 256, toolName ? 80 : 64, 16);
    context.fill();
    
    // Subtle border
    context.strokeStyle = 'rgba(79, 209, 197, 0.4)';
    context.lineWidth = 1;
    context.roundRect(0, 0, 256, toolName ? 80 : 64, 16);
    context.stroke();
    
    context.font = 'bold 22px Arial';
    context.fillStyle = '#e0f5f0';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 128, 24);
    
    if (toolName) {
        context.font = 'italic 14px Arial';
        context.fillStyle = '#4fd1c5';
        context.fillText(toolName, 128, 56);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, 6.5, 2);
    sprite.scale.set(7, toolName ? 2.2 : 1.8, 1);
    sprite.name = 'label';
    group.add(sprite);
    
    scene.add(group);
    agentMeshes.set(name, group);
    
    return group;
}

function updateDeskLabel(desk, name, toolName = null) {
    const sprite = desk.getObjectByName('label');
    if (!sprite) return;
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const scale = 2;
    canvas.width = 512;
    canvas.height = toolName ? 160 : 128;
    context.scale(scale, scale);
    
    context.fillStyle = 'rgba(20, 60, 60, 0.85)';
    context.roundRect(0, 0, 256, toolName ? 80 : 64, 16);
    context.fill();
    
    context.strokeStyle = 'rgba(79, 209, 197, 0.4)';
    context.lineWidth = 1;
    context.roundRect(0, 0, 256, toolName ? 80 : 64, 16);
    context.stroke();
    
    context.font = 'bold 22px Arial';
    context.fillStyle = '#e0f5f0';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 128, 24);
    
    if (toolName) {
        context.font = 'italic 14px Arial';
        context.fillStyle = '#4fd1c5';
        context.fillText(toolName, 128, 56);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    
    sprite.position.set(0, 6.5, 2);
    sprite.scale.set(7, toolName ? 2.2 : 1.8, 1);
}

function createMessageParticle(fromPos, toPos) {
    const particleGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const particleMat = new THREE.MeshBasicMaterial({ 
        color: 0xff6b6b,
        transparent: true,
        opacity: 0.95
    });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    
    particle.position.copy(fromPos);
    particle.position.y += 5;
    
    // Add a glow point light that follows particle
    const glow = new THREE.PointLight(0xff6b6b, 1.0, 10);
    particle.add(glow);
    
    scene.add(particle);
    
    const startTime = Date.now();
    const duration = 1500;
    
    function animateParticle() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        particle.position.lerpVectors(
            new THREE.Vector3(fromPos.x, fromPos.y + 5, fromPos.z),
            new THREE.Vector3(toPos.x, toPos.y + 5, toPos.z),
            progress
        );
        
        particle.position.y += Math.sin(progress * Math.PI) * 2;
        
        // Pulse size
        const pulse = Math.sin(progress * Math.PI) * 0.2 + 1;
        particle.scale.setScalar(pulse);
        
        if (progress < 1) {
            requestAnimationFrame(animateParticle);
        } else {
            scene.remove(particle);
        }
    }
    
    animateParticle();
}

function createConnectionLine(fromPos, toPos) {
    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 5, fromPos.z);
    const endPos = new THREE.Vector3(toPos.x, toPos.y + 5, toPos.z);
    
    // Create curved line with points
    const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
    mid.y += 2;
    
    const curve = new THREE.QuadraticBezierCurve3(startPos, mid, endPos);
    const points = curve.getPoints(50);
    
    // Main line - thicker, glowing red
    const material = new THREE.LineBasicMaterial({
        color: 0xff6b6b,
        opacity: 0.7,
        transparent: true,
        linewidth: 3
    });
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    
    scene.add(line);
    connectionLines.push(line);
    
    // Add small chevron markers along the path to show direction
    const direction = new THREE.Vector3().subVectors(endPos, startPos).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const numMarkers = 4;
    for (let i = 0; i < numMarkers; i++) {
        const t = (i + 1) / (numMarkers + 1);
        const markerPos = curve.getPoint(t);
        
        const markerGeo = new THREE.ConeGeometry(0.25, 0.7, 8);
        const markerMat = new THREE.MeshBasicMaterial({
            color: 0xff6b6b,
            transparent: true,
            opacity: 0.5
        });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        
        // Get tangent at this point for direction
        const tangent = curve.getTangent(t);
        marker.position.copy(markerPos);
        
        const markerQuat = new THREE.Quaternion();
        markerQuat.setFromUnitVectors(up, tangent);
        marker.setRotationFromQuaternion(markerQuat);
        
        scene.add(marker);
        connectionLines.push(marker);
    }
    
    setTimeout(() => {
        createMessageParticle(fromPos, toPos);
    }, 50);
}

function clearConnections() {
    connectionLines.forEach(line => scene.remove(line));
    connectionLines = [];
}

function updateVillage() {
    clearConnections();
    
    // Use recipients (from coworkers.db) as the authoritative list of agents
    const allAgents = new Set([config.user.toLowerCase(), ...recipients.map(r => r.toLowerCase())]);
    
    // Also add message participants
    messages.forEach(m => {
        allAgents.add(m.sender.toLowerCase());
        allAgents.add(m.recipient.toLowerCase());
    });
    
    // Arrange agents in a circle on the platform
    const agents = Array.from(allAgents);
    const radius = Math.min(20, Math.max(10, agents.length * 3));
    
    agents.forEach((agent, index) => {
        const angle = (index / agents.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const position = new THREE.Vector3(x, 0, z);
        
        const avatarState = avatarStates[agent.toLowerCase()];
        const toolName = avatarState?.tool_name || null;
        
        if (!agentMeshes.has(agent)) {
            const group = createAgentDesk(agent, position, toolName);
            // Face desk toward center
            group.lookAt(new THREE.Vector3(0, PLATFORM_HEIGHT, 0));
        } else {
            const desk = agentMeshes.get(agent);
            desk.position.set(x, PLATFORM_HEIGHT, z);
            desk.lookAt(new THREE.Vector3(0, PLATFORM_HEIGHT, 0));
            updateDeskLabel(desk, agent, toolName);
        }
    });
    
    // Remove desks for coworkers that no longer exist
    agentMeshes.forEach((desk, name) => {
        if (!allAgents.has(name)) {
            // Remove from scene
            scene.remove(desk);
            
            // Dispose of geometries and materials to prevent memory leaks
            desk.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
            
            // Remove from Map
            agentMeshes.delete(name);
        }
    });
    
    // Create connections for unread messages only
    allMessages.forEach(msg => {
        const fromDesk = agentMeshes.get(msg.sender.toLowerCase());
        const toDesk = agentMeshes.get(msg.recipient.toLowerCase());
        
        if (fromDesk && toDesk && !msg.read) {
            createConnectionLine(
                fromDesk.position,
                toDesk.position
            );
        }
    });
    
    // Update desk labels with unread indicators
    updateDeskLabels();
}

function animate() {
    requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Rotate holographic sphere
    if (holoSphere) {
        holoSphere.rotation.y = time * 0.15;
        holoSphere.rotation.x = Math.sin(time * 0.1) * 0.1;
    }
    
    // Animate floating particles
    floatingParticles.forEach((particles, index) => {
        const positions = particles.geometry.attributes.position.array;
        
        if (particles.userData.twinklePhase !== undefined) {
            // Star twinkling effect
            const twinkle = Math.sin(time * 2 + particles.userData.twinklePhase) * 0.3 + 0.7;
            particles.material.opacity = 0.4 + twinkle * 0.4;
            
            // Slowly rotate stars
            particles.rotation.y = time * 0.02;
        } else {
            // Regular floating particles
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] += Math.sin(time + positions[i] * 0.1) * 0.003;
            }
            particles.geometry.attributes.position.needsUpdate = true;
        }
    });
    
    // Subtle glow pulse on lamps
    glowLights.forEach((item, i) => {
        const pulse = Math.sin(time * 1.5 + i) * 0.15 + 1;
        item.light.intensity = item.baseIntensity * pulse;
    });
    
    // Animate water ripples
    if (waterMesh && waterMesh.userData.initialPositions) {
        const positions = waterMesh.geometry.attributes.position;
        const initialPositions = waterMesh.userData.initialPositions;
        
        for (let i = 0; i < positions.count; i++) {
            const x = initialPositions[i * 3];
            const y = initialPositions[i * 3 + 1];
            
            // Create gentle ripple effect
            const distance = Math.sqrt(x * x + y * y);
            const wave1 = Math.sin(distance * 0.3 - time * 0.8) * 0.15;
            const wave2 = Math.sin(x * 0.2 + time * 0.5) * 0.1;
            const wave3 = Math.cos(y * 0.15 + time * 0.3) * 0.08;
            
            positions.setZ(i, wave1 + wave2 + wave3);
        }
        positions.needsUpdate = true;
    }
    
    controls.update();
    
    // Use composer for bloom effect if available, otherwise standard renderer
    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    
    // Resize composer for bloom effect
    if (composer) {
        composer.setSize(width, height);
    }
    
    if (width < 768) {
        camera.position.y = Math.max(camera.position.y, 40);
        camera.position.z = Math.max(camera.position.z, 50);
        controls.minDistance = 35;
    } else {
        controls.minDistance = 25;
    }
}

// API and UI Functions
async function loadData() {
    try {
        const [configRes, messagesRes, coworkersRes, allMessagesRes] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/messages'),
            fetch('/api/coworkers'),
            fetch('/api/messages/all')
        ]);
        
        config = await configRes.json();
        const messagesData = await messagesRes.json();
        const recipientsData = await coworkersRes.json();
        const allMessagesData = await allMessagesRes.json();
        
        // Validate responses are arrays (not error objects)
        messages = Array.isArray(messagesData) ? messagesData : [];
        recipients = Array.isArray(recipientsData) ? recipientsData : [];
        allMessages = Array.isArray(allMessagesData) ? allMessagesData : [];
        
        // Load avatar states if avatar DB is configured
        if (config.avatar) {
            try {
                const avatarsRes = await fetch('/api/avatars');
                avatarStates = await avatarsRes.json();
            } catch (err) {
                console.error('Error loading avatar states:', err);
                avatarStates = {};
            }
        }
        
        updateUI();
        updateVillage();
    } catch (err) {
        console.error('Error loading data:', err);
    }
}

// Panel toggle functions
window.toggleSendPanel = function() {
    const panel = document.getElementById('send-panel');
    const btn = document.getElementById('collapse-btn');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
};

window.toggleMessagesPanel = function() {
    const panel = document.getElementById('messages-panel');
    const btn = document.getElementById('toggle-messages-btn');
    panel.classList.toggle('open');
    btn.style.opacity = panel.classList.contains('open') ? '0' : '1';
    btn.style.pointerEvents = panel.classList.contains('open') ? 'none' : 'auto';
};

function updateUI() {
    const unread = messages.filter(m => !m.read && m.recipient.toLowerCase() === config.user.toLowerCase()).length;
    
    // Update messages button - change icon and show badge when unread
    const msgBtn = document.getElementById('toggle-messages-btn');
    const badge = document.getElementById('unread-badge');
    if (unread > 0) {
        msgBtn.innerHTML = `🔔 Messages <span class="badge" id="unread-badge">${unread}</span>`;
    } else {
        msgBtn.innerHTML = `📨 Messages <span class="badge" id="unread-badge" style="display: none;">0</span>`;
    }
    
    // Update recipient select (send panel) - only from coworkers.db
    const select = document.getElementById('recipient-select');
    const currentVal = select.value;
    const everyoneOption = recipients.length > 0 ? '<option value="@everyone" style="font-weight: bold; color: #5EEAD4;">@everyone (broadcast to all)</option>' : '';
    select.innerHTML = '<option value="">Coworker...</option>' +
        everyoneOption +
        recipients.sort().map(r => 
            `<option value="${r}" ${r === currentVal ? 'selected' : ''}>${r}</option>`
        ).join('');
    
    // Update messages list (slide-out panel)
    const messagesDiv = document.getElementById('messages-container');
    if (messages.length === 0) {
        messagesDiv.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
                <p>No messages yet</p>
            </div>
        `;
    } else {
        messagesDiv.innerHTML = messages.slice(0, 20).map(msg => renderMessageCard(msg, true)).join('');
        
        // Add click handlers for all messages (clicking marks as read and sets recipient for reply)
        messagesDiv.querySelectorAll('.message-card').forEach(el => {
            el.addEventListener('click', () => {
                const msgId = el.dataset.id;
                const sender = el.dataset.sender;
                const recipient = el.dataset.recipient;
                
                // Determine who to reply to
                // If I received the message, reply to sender
                // If I sent the message, reply to the original recipient
                const myName = config.user.toLowerCase();
                const replyTo = recipient.toLowerCase() === myName ? sender : recipient;
                
                // Set the recipient select
                const select = document.getElementById('recipient-select');
                if (select) {
                    select.value = replyTo;
                }
                
                // Mark as read
                markAsRead(msgId);
                
                // Expand send panel if collapsed
                const sendPanel = document.getElementById('send-panel');
                if (sendPanel && sendPanel.classList.contains('collapsed')) {
                    toggleSendPanel();
                }
                
                // Focus the message input for typing
                const messageInput = document.getElementById('message-input');
                if (messageInput) {
                    messageInput.focus();
                }
            });
        });
    }
    
    // Update desk dialog if it's open
    if (document.getElementById('house-dialog').classList.contains('active')) {
        updateDeskDialogContent();
    }
}

async function markAsRead(id) {
    try {
        await fetch(`/api/messages/${id}/read`, { method: 'POST' });
        loadData();
    } catch (err) {
        console.error('Error marking as read:', err);
    }
}

window.markAllAsRead = async function() {
    const unreadMessages = messages.filter(m => !m.read && m.recipient.toLowerCase() === config.user.toLowerCase());
    if (unreadMessages.length === 0) return;
    
    try {
        await Promise.all(unreadMessages.map(m => fetch(`/api/messages/${m.id}/read`, { method: 'POST' })));
        loadData();
    } catch (err) {
        console.error('Error marking all as read:', err);
    }
};

async function sendMessage() {
    const to = document.getElementById('recipient-select').value;
    const message = document.getElementById('message-input').value.trim();
    
    if (!to || !message) {
        alert('Please select a coworker and enter a message');
        return;
    }
    
    try {
        let sendPromises;
        
        if (to === '@everyone') {
            // Send to all recipients individually
            sendPromises = recipients.map(recipient => 
                fetch('/api/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: recipient, from: config.user, message })
                })
            );
        } else {
            // Send to single recipient
            sendPromises = [fetch('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, from: config.user, message })
            })];
        }
        
        const responses = await Promise.all(sendPromises);
        const allSuccessful = responses.every(r => r.ok);
        
        if (allSuccessful) {
            // Clear input
            document.getElementById('message-input').value = '';
            
            // Show toast
            const toast = document.getElementById('toast');
            const toastMsg = document.getElementById('toast-message');
            if (toastMsg && to === '@everyone') {
                toastMsg.textContent = `Message broadcast to ${recipients.length} coworkers!`;
            }
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                if (toastMsg) toastMsg.textContent = 'Message sent!';
            }, 3000);
            
            // Reload data
            loadData();
        } else {
            alert('Failed to send message to some recipients');
        }
    } catch (err) {
        console.error('Error sending:', err);
        alert('Error sending message');
    }
}

// Desk click handler
function onDeskClick(event) {
    handleDeskInteraction(event.clientX, event.clientY);
}

// Touch handlers for mobile
let touchStartX = 0;
let touchStartY = 0;

function onDeskTouchStart(event) {
    if (event.touches.length === 1) {
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
    }
}

function onDeskTouchEnd(event) {
    if (event.changedTouches.length === 1) {
        const touchEndX = event.changedTouches[0].clientX;
        const touchEndY = event.changedTouches[0].clientY;
        
        // Check if touch moved significantly (if so, it's a drag/pan, not a tap)
        const moveDistance = Math.sqrt(
            Math.pow(touchEndX - touchStartX, 2) + 
            Math.pow(touchEndY - touchStartY, 2)
        );
        
        // Only trigger if touch didn't move much (tap vs swipe)
        if (moveDistance < 20) {
            handleDeskInteraction(touchEndX, touchEndY);
        }
    }
}

// Common desk interaction handler
function handleDeskInteraction(clientX, clientY) {
    // Calculate normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    
    mouse.x = x;
    mouse.y = y;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Get all desk meshes
    const deskMeshes = [];
    agentMeshes.forEach((group, name) => {
        group.children.forEach(child => {
            if (child.isMesh && !child.userData.isBubble && !child.userData.isCup) {
                child.userData.agentName = name;
                deskMeshes.push(child);
            }
        });
    });
    
    const intersects = raycaster.intersectObjects(deskMeshes);
    
    if (intersects.length > 0) {
        const agentName = intersects[0].object.userData.agentName;
        if (agentName) {
            showDeskDialog(agentName);
        }
    }
}

// Global variable to track current agent for desk dialog
let currentDeskAgent = null;
let currentTab = 'received';

// Show dialog with messages for a specific agent
async function showDeskDialog(agentName) {
    currentDeskAgent = agentName.toLowerCase();
    currentTab = 'received'; // Default to received tab
    
    const dialog = document.getElementById('house-dialog');
    const title = document.getElementById('house-dialog-title');
    
    // Capitalize first letter
    const displayName = agentName.charAt(0).toUpperCase() + agentName.slice(1);
    title.textContent = `${displayName}'s Messages`;
    
    // Update tab labels
    document.getElementById('tab-received').innerHTML = 
        `📥 Received by ${displayName} <span id="received-count" class="tab-badge"></span>`;
    document.getElementById('tab-sent').innerHTML = 
        `📤 Sent by ${displayName} <span id="sent-count" class="tab-badge"></span>`;
    
    // Load all messages (both sent and received) for this dialog
    try {
        const response = await fetch('/api/messages/all');
        allMessages = await response.json();
    } catch (err) {
        console.error('Error loading all messages:', err);
        allMessages = [];
    }
    
    // Switch to received tab by default
    switchTab('received');
    
    dialog.classList.add('active');
}

// Tab switching function
window.switchTab = function(tab) {
    currentTab = tab;
    
    // Update tab buttons
    document.getElementById('tab-received').classList.toggle('active', tab === 'received');
    document.getElementById('tab-sent').classList.toggle('active', tab === 'sent');
    
    // Update content
    updateDeskDialogContent();
};

function updateDeskDialogContent() {
    const content = document.getElementById('house-dialog-content');
    
    if (!currentDeskAgent) return;
    
    // Filter messages based on current tab - FROM THE AGENT'S PERSPECTIVE
    let filteredMessages;
    if (currentTab === 'received') {
        // Messages RECEIVED BY the agent (sent TO the agent)
        filteredMessages = allMessages.filter(m => 
            m.recipient.toLowerCase() === currentDeskAgent
        );
    } else {
        // Messages SENT BY the agent
        filteredMessages = allMessages.filter(m => 
            m.sender.toLowerCase() === currentDeskAgent
        );
    }
    
    // Update count badges
    const receivedCount = allMessages.filter(m => 
        m.recipient.toLowerCase() === currentDeskAgent
    ).length;
    
    const sentCount = allMessages.filter(m => 
        m.sender.toLowerCase() === currentDeskAgent
    ).length;
    
    const receivedBadge = document.getElementById('received-count');
    const sentBadge = document.getElementById('sent-count');
    
    receivedBadge.textContent = receivedCount > 0 ? receivedCount : '';
    sentBadge.textContent = sentCount > 0 ? sentCount : '';
    
    // Render messages
    if (filteredMessages.length === 0) {
        content.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
                <p>No ${currentTab} messages</p>
            </div>
        `;
    } else {
        content.innerHTML = filteredMessages.map(msg => renderMessageCard(msg, true)).join('');
    }
}

window.closeDeskDialog = function() {
    document.getElementById('house-dialog').classList.remove('active');
};

// Update desk labels to show unread indicators and tool names
function updateDeskLabels() {
    agentMeshes.forEach((group, name) => {
        const unreadCount = allMessages.filter(m => 
            m.recipient.toLowerCase() === name.toLowerCase() && 
            m.sender.toLowerCase() === config.user.toLowerCase() &&
            !m.read
        ).length;
        
        const unreadFromAgent = allMessages.filter(m => 
            m.sender.toLowerCase() === name.toLowerCase() && 
            m.recipient.toLowerCase() === config.user.toLowerCase() &&
            !m.read
        ).length;
        
        const avatarState = avatarStates[name.toLowerCase()];
        const toolName = avatarState?.tool_name || null;
        
        const sprite = group.children.find(c => c.isSprite);
        if (sprite) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const scale = 2;
            canvas.width = 700;
            canvas.height = toolName ? 160 : 128;
            context.scale(scale, scale);
            
            // Background - themed colors for state
            if (unreadFromAgent > 0) {
                context.fillStyle = 'rgba(220, 80, 80, 0.85)';
            } else if (unreadCount > 0) {
                context.fillStyle = 'rgba(59, 130, 180, 0.85)';
            } else {
                context.fillStyle = 'rgba(20, 60, 60, 0.85)';
            }
            context.roundRect(0, 0, 350, toolName ? 80 : 64, 16);
            context.fill();
            
            // Border
            context.strokeStyle = unreadFromAgent > 0 
                ? 'rgba(255, 120, 120, 0.6)' 
                : unreadCount > 0 
                    ? 'rgba(100, 180, 255, 0.6)' 
                    : 'rgba(79, 209, 197, 0.3)';
            context.lineWidth = 1;
            context.roundRect(0, 0, 350, toolName ? 80 : 64, 16);
            context.stroke();
            
            context.font = 'bold 22px Arial';
            context.fillStyle = '#e0f5f0';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            
            if (unreadFromAgent > 0) {
                context.fillText(`${name}  ${unreadFromAgent}`, 175, 24);
            } else if (unreadCount > 0) {
                context.fillText(`${name}  ${unreadCount}`, 175, 24);
            } else {
                context.fillText(name, 175, 24);
            }
            
            if (toolName) {
                context.font = 'italic 14px Arial';
                context.fillStyle = '#4fd1c5';
                context.fillText(toolName, 175, 56);
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            sprite.material.map = texture;
            sprite.material.needsUpdate = true;
            
            sprite.position.set(0, 6.5, 2);
            sprite.scale.set(7, toolName ? 2.2 : 1.8, 1);
        }
    });
}

// Parse markdown frontmatter from message text
function parseFrontmatter(text) {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
    const match = text.match(frontmatterRegex);
    
    if (!match) {
        return { content: text, frontmatter: null };
    }
    
    const frontmatterText = match[1];
    const content = text.slice(match[0].length).trim();
    
    // Simple YAML-like parsing
    const frontmatter = {};
    const lines = frontmatterText.split('\n');
    
    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            let value = line.slice(colonIndex + 1).trim();
            
            // Handle arrays: choices: ["option1", "option2"]
            if (value.startsWith('[') && value.endsWith(']')) {
                try {
                    value = JSON.parse(value.replace(/'/g, '"'));
                } catch {
                    // Fallback: parse as comma-separated
                    value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
                }
            } else if (value.startsWith('- ')) {
                // YAML array format with dashes - collect all consecutive dash items
                // This is handled below by checking the whole frontmatter
            } else {
                // Remove quotes if present
                value = value.replace(/^["']|["']$/g, '');
            }
            
            frontmatter[key] = value;
        }
    }
    
    // Handle YAML array format: choices:\n  - option1\n  - option2
    const choicesMatch = frontmatterText.match(/choices:\s*\n((?:\s*-\s*[^\n]+\n?)+)/);
    if (choicesMatch) {
        const choicesLines = choicesMatch[1].trim().split('\n');
        frontmatter.choices = choicesLines
            .map(line => line.replace(/^\s*-\s*/, '').trim())
            .filter(line => line)
            .map(choice => choice.replace(/^["']|["']$/g, ''));
    }
    
    return { content, frontmatter };
}

// Send a quick response from a choice button
window.sendQuickResponse = async function(to, message, messageId) {
    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, from: config.user, message })
        });
        
        if (response.ok) {
            // Mark the original message as read if messageId is provided
            if (messageId) {
                await fetch(`/api/messages/${messageId}/read`, { method: 'POST' });
            }
            
            // Show toast
            const toast = document.getElementById('toast');
            const toastMsg = document.getElementById('toast-message');
            if (toastMsg) toastMsg.textContent = 'Quick reply sent!';
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                if (toastMsg) toastMsg.textContent = 'Message sent!';
            }, 2000);
            
            // Reload data
            loadData();
        } else {
            console.error('Failed to send quick response');
        }
    } catch (err) {
        console.error('Error sending quick response:', err);
    }
}

// Render a message card HTML with optional choice buttons
function renderMessageCard(msg, showChoices = true) {
    const { content, frontmatter } = parseFrontmatter(msg.message);
    const choices = frontmatter?.choices;
    const showChoicesButtons = showChoices && Array.isArray(choices) && choices.length > 0;
    const replyTo = msg.recipient.toLowerCase() === config.user.toLowerCase() ? msg.sender : msg.recipient;
    
    return `
        <div class="message-card ${msg.read ? '' : 'unread'}" data-id="${msg.id}" data-sender="${msg.sender}" data-recipient="${msg.recipient}">
            <div class="message-header">
                <span class="message-sender">${msg.sender} → ${msg.recipient}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            <div class="message-text">${marked.parse(content)}</div>
            ${showChoicesButtons ? `
                <div class="message-choices">
                    ${choices.map((choice) => `
                        <button class="choice-btn" onclick="sendQuickResponse('${replyTo}', '${choice.replace(/'/g, "\\'")}', ${msg.id})">
                            ${choice}
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

// Event listeners
document.getElementById('send-btn').addEventListener('click', sendMessage);

// Initialize
init();
loadData();
setInterval(loadData, 5000);
