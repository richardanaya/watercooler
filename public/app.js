import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// State
let config = { user: '', mailbox: '' };
let messages = []; // Messages TO user (for main panel)
let allMessages = []; // All messages involving user (for house dialogs)
let recipients = [];
let scene, camera, renderer, controls;
let agentMeshes = new Map();
let connectionLines = [];
let raycaster, mouse;

// Color palette for agents
const agentColors = [
  0xFF6B6B, 0x4ECDC4, 0x45B7D1, 0xFFA07A, 0x98D8C8, 
  0xF7DC6F, 0xBB8FCE, 0x85C1E2, 0xF8B500, 0x6C5CE7
];

function getAgentColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return agentColors[Math.abs(hash) % agentColors.length];
}

// Initialize Three.js
function init() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x667eea);
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 30, 40);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.1;
    controls.minDistance = 20;
    controls.maxDistance = 80;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false; // Disable pan on touch for better mobile UX
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);
    
    // Ground
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ 
        color: 0x7dd3c0,
        roughness: 0.8 
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Grid helper
    const grid = new THREE.GridHelper(200, 50, 0xffffff, 0xffffff);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);
    
    // Trees
    createTrees();
    
    window.addEventListener('resize', onWindowResize);
    
    // Raycaster for house clicks
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('click', onHouseClick);
    
    // Add touch support for mobile
    renderer.domElement.addEventListener('touchstart', onHouseTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchend', onHouseTouchEnd, { passive: false });
    
    // Disable context menu on mobile for better UX
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Handle orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(onWindowResize, 100);
    });
    
    animate();
}

function createTrees() {
    for (let i = 0; i < 30; i++) {
        const x = (Math.random() - 0.5) * 150;
        const z = (Math.random() - 0.5) * 150;
        
        // Don't place trees too close to center
        if (Math.sqrt(x*x + z*z) < 30) continue;
        
        const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 3, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 1.5, z);
        trunk.castShadow = true;
        
        const leavesGeo = new THREE.ConeGeometry(3, 8, 8);
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const leaves = new THREE.Mesh(leavesGeo, leavesMat);
        leaves.position.set(x, 6, z);
        leaves.castShadow = true;
        
        scene.add(trunk);
        scene.add(leaves);
    }
}

function createAgentHouse(name, position) {
    const color = getAgentColor(name);
    const group = new THREE.Group();
    group.position.copy(position);
    
    // House base
    const baseGeo = new THREE.BoxGeometry(6, 4, 6);
    const baseMat = new THREE.MeshStandardMaterial({ color: color });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    
    // Roof
    const roofGeo = new THREE.ConeGeometry(5, 3, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 5.5;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);
    
    // Door
    const doorGeo = new THREE.BoxGeometry(1.5, 2.5, 0.2);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3c28 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 1.25, 3.1);
    group.add(door);
    
    // Windows
    const windowGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2);
    const windowMat = new THREE.MeshStandardMaterial({ 
        color: 0xFFFF99,
        emissive: 0xFFFF99,
        emissiveIntensity: 0.3
    });
    
    const window1 = new THREE.Mesh(windowGeo, windowMat);
    window1.position.set(-1.8, 2.5, 3.1);
    group.add(window1);
    
    const window2 = new THREE.Mesh(windowGeo, windowMat);
    window2.position.set(1.8, 2.5, 3.1);
    group.add(window2);
    
    // Name label sprite
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    // High DPI canvas for crisp text
    const scale = 2;
    canvas.width = 512;
    canvas.height = 128;
    context.scale(scale, scale);
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(0, 0, 256, 64, 16);
    context.fill();
    context.font = 'bold 24px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 128, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, 8, 0);
    sprite.scale.set(8, 2, 1);
    group.add(sprite);
    
    // Path to house
    const pathGeo = new THREE.PlaneGeometry(2, 8);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C });
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.02, 7);
    group.add(path);
    
    scene.add(group);
    agentMeshes.set(name, group);
    
    return group;
}

function createMessageParticle(fromPos, toPos) {
    const particleGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const particleMat = new THREE.MeshStandardMaterial({ 
        color: 0xFFD700,
        emissive: 0xFFD700,
        emissiveIntensity: 0.5
    });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    
    particle.position.copy(fromPos);
    particle.position.y += 8;
    
    scene.add(particle);
    
    // Animate particle
    const startTime = Date.now();
    const duration = 2000;
    
    function animateParticle() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        particle.position.lerpVectors(
            new THREE.Vector3(fromPos.x, fromPos.y + 8, fromPos.z),
            new THREE.Vector3(toPos.x, toPos.y + 8, toPos.z),
            progress
        );
        
        // Add arc
        particle.position.y += Math.sin(progress * Math.PI) * 3;
        
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
    
    const material = new THREE.LineBasicMaterial({
        color: 0xff6b6b,
        opacity: 0.8,
        transparent: true,
        linewidth: 3
    });
    
    const points = [startPos, endPos];
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    
    scene.add(line);
    connectionLines.push(line);
    
    // Add arrowhead for directionality
    const direction = new THREE.Vector3().subVectors(endPos, startPos).normalize();
    const arrowPos = endPos.clone().sub(direction.clone().multiplyScalar(5));
    
    const arrowGeometry = new THREE.ConeGeometry(0.5, 1.5, 8);
    const arrowMaterial = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        emissive: 0xff6b6b,
        emissiveIntensity: 0.3
    });
    const arrowhead = new THREE.Mesh(arrowGeometry, arrowMaterial);
    
    arrowhead.position.copy(arrowPos);
    
    // Orient arrow to point along the line
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(up, direction);
    arrowhead.setRotationFromQuaternion(quaternion);
    
    scene.add(arrowhead);
    connectionLines.push(arrowhead);
    
    // Send particle
    setTimeout(() => {
        createMessageParticle(fromPos, toPos);
    }, 100);
}

function clearConnections() {
    connectionLines.forEach(line => scene.remove(line));
    connectionLines = [];
}

function updateVillage() {
    clearConnections();
    
    // Use recipients (from coworkers.db) as the authoritative list of agents
    // This ensures we only show houses for registered coworkers
    const allAgents = new Set([config.user.toLowerCase(), ...recipients.map(r => r.toLowerCase())]);
    
    // Also add message participants that might not be in coworker db yet
    messages.forEach(m => {
        allAgents.add(m.sender.toLowerCase());
        allAgents.add(m.recipient.toLowerCase());
    });
    
    // Arrange agents in a circle
    const agents = Array.from(allAgents);
    const radius = 25;
    
    agents.forEach((agent, index) => {
        const angle = (index / agents.length) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const position = new THREE.Vector3(x, 0, z);
        
        if (!agentMeshes.has(agent)) {
            createAgentHouse(agent, position);
        } else {
            // Update position if needed
            const house = agentMeshes.get(agent);
            house.position.copy(position);
        }
    });
    
    // Create connections for unread messages only
    allMessages.forEach(msg => {
        const fromHouse = agentMeshes.get(msg.sender.toLowerCase());
        const toHouse = agentMeshes.get(msg.recipient.toLowerCase());
        
        if (fromHouse && toHouse && !msg.read) {
            createConnectionLine(
                fromHouse.position,
                toHouse.position
            );
        }
    });
    
    // Update house labels with unread indicators
    updateHouseLabels();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    
    // Adjust camera position for better mobile view
    if (width < 768) {
        // On mobile, position camera slightly higher and further back
        camera.position.y = Math.max(camera.position.y, 35);
        camera.position.z = Math.max(camera.position.z, 45);
        controls.minDistance = 30; // Prevent zooming too close on mobile
    } else {
        controls.minDistance = 20;
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
    select.innerHTML = '<option value="">Coworker...</option>' +
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
        messagesDiv.innerHTML = messages.slice(0, 20).map(msg => `
            <div class="message-card ${msg.read ? '' : 'unread'}" data-id="${msg.id}" data-sender="${msg.sender}" data-recipient="${msg.recipient}">
                <div class="message-header">
                    <span class="message-sender">${msg.sender} → ${msg.recipient}</span>
                    <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="message-text">${marked.parse(msg.message)}</div>
            </div>
        `).join('');
        
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
    
    // Update house dialog if it's open
    if (document.getElementById('house-dialog').classList.contains('active')) {
        updateHouseDialogContent();
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

async function sendMessage() {
    const to = document.getElementById('recipient-select').value;
    const message = document.getElementById('message-input').value.trim();
    
    if (!to || !message) {
        alert('Please select a coworker and enter a message');
        return;
    }
    
    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, from: config.user, message })
        });
        
        if (response.ok) {
            // Clear input
            document.getElementById('message-input').value = '';
            
            // Show toast
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
            
            // Reload data
            loadData();
        } else {
            alert('Failed to send message');
        }
    } catch (err) {
        console.error('Error sending:', err);
        alert('Error sending message');
    }
}

// House click handler
function onHouseClick(event) {
    handleHouseInteraction(event.clientX, event.clientY);
}

// Touch handlers for mobile
let touchStartX = 0;
let touchStartY = 0;

function onHouseTouchStart(event) {
    if (event.touches.length === 1) {
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
    }
}

function onHouseTouchEnd(event) {
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
            handleHouseInteraction(touchEndX, touchEndY);
        }
    }
}

// Common house interaction handler
function handleHouseInteraction(clientX, clientY) {
    // Calculate normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    
    mouse.x = x;
    mouse.y = y;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Get all house meshes
    const houseMeshes = [];
    agentMeshes.forEach((group, name) => {
        group.children.forEach(child => {
            if (child.isMesh && !child.userData.isBubble && !child.userData.isCup) {
                child.userData.agentName = name;
                houseMeshes.push(child);
            }
        });
    });
    
    const intersects = raycaster.intersectObjects(houseMeshes);
    
    if (intersects.length > 0) {
        const agentName = intersects[0].object.userData.agentName;
        if (agentName) {
            showHouseDialog(agentName);
        }
    }
}

// Global variable to track current agent for house dialog
let currentHouseAgent = null;
let currentTab = 'received';

// Show dialog with messages for a specific agent
async function showHouseDialog(agentName) {
    currentHouseAgent = agentName.toLowerCase();
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
    updateHouseDialogContent();
};

function updateHouseDialogContent() {
    const content = document.getElementById('house-dialog-content');
    
    if (!currentHouseAgent) return;
    
    // Filter messages based on current tab - FROM THE AGENT'S PERSPECTIVE
    let filteredMessages;
    if (currentTab === 'received') {
        // Messages RECEIVED BY the agent (sent TO the agent)
        filteredMessages = allMessages.filter(m => 
            m.recipient.toLowerCase() === currentHouseAgent
        );
    } else {
        // Messages SENT BY the agent
        filteredMessages = allMessages.filter(m => 
            m.sender.toLowerCase() === currentHouseAgent
        );
    }
    
    // Update count badges
    const receivedCount = allMessages.filter(m => 
        m.recipient.toLowerCase() === currentHouseAgent
    ).length;
    
    const sentCount = allMessages.filter(m => 
        m.sender.toLowerCase() === currentHouseAgent
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
        content.innerHTML = filteredMessages.map(msg => `
            <div class="message-card ${msg.read ? '' : 'unread'}" style="margin-bottom: 12px;">
                <div class="message-header">
                    <span class="message-sender">${msg.sender} → ${msg.recipient}</span>
                    <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="message-text">${marked.parse(msg.message)}</div>
            </div>
        `).join('');
    }
}

window.closeHouseDialog = function() {
    document.getElementById('house-dialog').classList.remove('active');
};

// Update house labels to show unread indicators
function updateHouseLabels() {
    agentMeshes.forEach((group, name) => {
        // Check for unread messages SENT TO this agent (messages they haven't read)
        const unreadCount = allMessages.filter(m => 
            m.recipient.toLowerCase() === name.toLowerCase() && 
            m.sender.toLowerCase() === config.user.toLowerCase() &&
            !m.read
        ).length;
        
        // Also check if this agent has sent unread messages TO user
        const unreadFromAgent = allMessages.filter(m => 
            m.sender.toLowerCase() === name.toLowerCase() && 
            m.recipient.toLowerCase() === config.user.toLowerCase() &&
            !m.read
        ).length;
        
        // Find the sprite label
        const sprite = group.children.find(c => c.isSprite);
        if (sprite) {
            // Update the canvas texture - high DPI for crisp text
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const scale = 2;
            canvas.width = 700;
            canvas.height = 128;
            context.scale(scale, scale);
            
            // Background - change color if there are unread messages
            if (unreadFromAgent > 0) {
                // Red background for unread messages from agent
                context.fillStyle = 'rgba(220, 53, 69, 0.9)';
            } else if (unreadCount > 0) {
                // Blue background for messages sent but not read
                context.fillStyle = 'rgba(0, 123, 255, 0.9)';
            } else {
                // Default black background
                context.fillStyle = 'rgba(0, 0, 0, 0.7)';
            }
            context.roundRect(0, 0, 350, 64, 16);
            context.fill();
            
            // Name
            context.font = 'bold 24px Arial';
            context.fillStyle = 'white';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            
            if (unreadFromAgent > 0) {
                // Show name with unread indicator from agent
                context.fillText(`${name} 🔴 ${unreadFromAgent}`, 175, 32);
            } else if (unreadCount > 0) {
                // Show name with sent-but-unread count
                context.fillText(`${name} 📤 ${unreadCount}`, 175, 32);
            } else {
                context.fillText(name, 175, 32);
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            sprite.material.map = texture;
            sprite.material.needsUpdate = true;
        }
    });
}

// Event listeners
document.getElementById('send-btn').addEventListener('click', sendMessage);

// Initialize
init();
loadData();
setInterval(loadData, 5000);
