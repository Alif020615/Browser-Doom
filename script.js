// --- DOOM.JS ENGINE CONFIG & VARIABLES ---

const CELL_SIZE = 12;
let MAP_GRID = [];

// Game state variables
let camera, scene, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();

// Player state
let player = {
    x: CELL_SIZE * 2.5,
    z: CELL_SIZE * 2.5,
    health: 100,
    armor: 50,
    keys: { red: false, blue: false, yellow: false },
    activeWeaponIdx: 1, // Pistol
    weaponsUnlocked: [true, true, false, false], // Fist, Pistol, Shotgun, Plasma
    ammo: {
        pistol: 50,
        shotgun: 0,
        plasma: 0
    }
};

const WEAPONS_STATS = [
    { name: 'FIST', ammoType: 'none', sound: 'punch', damage: 25, delay: 350, key: 'fist' },
    { name: 'PISTOL', ammoType: 'pistol', sound: 'pistol', damage: 15, delay: 250, key: 'pistol' },
    { name: 'SHOTGUN', ammoType: 'shotgun', sound: 'shotgun', damage: 65, delay: 800, key: 'shotgun' },
    { name: 'PLASMA', ammoType: 'plasma', sound: 'plasma', damage: 24, delay: 100, key: 'plasma' }
];

let currentLevel = 1;
let levelKillCount = 0;
const levelObjectiveKills = 8;
let portalActive = false;
let bossEntity = null;

let weaponImages = {}; // Data URLs
let isDead = false;
let isWin = false;
let currentFaceExpr = 'idle';
let faceTimer = 0;
let sceneTextures;
let pickupTextures;
let enemyTextures;

// Game objects
let walls = [];
let doors = [];
let pickups = [];
let enemies = [];
let particles = [];
let projectiles = [];
let lightObjects = [];

let yawObject, pitchObject;
let playerLight;
let floorMesh, ceilMesh;
let lastPortalMsgTime = 0;
let isLocked = false;
const PI_2 = Math.PI / 2;
let recoilPitch = 0;

// Minimap
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// --- WEB AUDIO SYNTHESIZER (SOUND MANAGER) ---
class SoundManager {
    constructor() {
        this.ctx = null;
        this.musicPlaying = false;
        this.tempo = 120;
        this.musicInterval = null;
        this.step = 0;
    }

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.startMusic();
    }

    playSound(type) {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const now = this.ctx.currentTime;
        switch(type) {
            case 'pistol': {
                const bufferSize = this.ctx.sampleRate * 0.1;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noiseNode = this.ctx.createBufferSource();
                noiseNode.buffer = buffer;
                
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1000, now);

                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

                noiseNode.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                noiseNode.start(now);
                break;
            }
            case 'shotgun': {
                const bufferSize = this.ctx.sampleRate * 0.35;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(700, now);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.7, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                noise.start(now);

                setTimeout(() => this.playSynthTone(550, 0.05, 'triangle', 0.1), 350);
                setTimeout(() => this.playSynthTone(350, 0.06, 'triangle', 0.1), 450);
                break;
            }
            case 'plasma': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(900, now);
                osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.12);
                break;
            }
            case 'punch': {
                this.playSynthTone(80, 0.1, 'sine', 0.7);
                break;
            }
            case 'player_pain': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(110, now);
                osc.frequency.linearRampToValueAtTime(70, now + 0.15);
                gain.gain.setValueAtTime(0.6, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            }
            case 'enemy_pain': {
                this.playSynthTone(240, 0.1, 'sawtooth', 0.3);
                break;
            }
            case 'enemy_death': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, now);
                osc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
                gain.gain.setValueAtTime(0.6, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
            }
            case 'boss_screamer': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(80, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.8);
                gain.gain.setValueAtTime(0.8, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + 0.8);
                break;
            }
            case 'pickup': {
                const notes = [261.63, 329.63, 392.00, 523.25];
                notes.forEach((freq, idx) => {
                    setTimeout(() => {
                        this.playSynthTone(freq, 0.05, 'triangle', 0.2);
                    }, idx * 50);
                });
                break;
            }
            case 'door': {
                this.playSynthTone(150, 0.6, 'sawtooth', 0.15);
                break;
            }
            case 'door_buzz': {
                this.playSynthTone(90, 0.25, 'sawtooth', 0.4);
                break;
            }
            case 'win': {
                const fan = [523.25, 659.25, 783.99, 1046.50];
                fan.forEach((freq, idx) => {
                    setTimeout(() => {
                        this.playSynthTone(freq, 0.18, 'square', 0.25);
                    }, idx * 100);
                });
                break;
            }
        }
    }

    playSynthTone(freq, dur, type = 'sine', volume = 0.5) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + dur);
    }

    startMusic() {
        if (this.musicPlaying) return;
        this.musicPlaying = true;
        const stepTime = 60 / this.tempo / 2;
        const isBossLvl = currentLevel === 3;

        const normalRiff = [
            41.20, 41.20, 48.99, 41.20, 55.00, 41.20, 58.27, 61.74,
            41.20, 41.20, 48.99, 41.20, 55.00, 41.20, 58.27, 41.20
        ];
        // Fast intense riff for boss fight
        const bossRiff = [
            55.00, 55.00, 65.41, 55.00, 73.42, 55.00, 77.78, 82.41,
            55.00, 55.00, 65.41, 55.00, 73.42, 55.00, 77.78, 55.00
        ];

        this.musicInterval = setInterval(() => {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            const riff = isBossLvl ? bossRiff : normalRiff;
            const note = riff[this.step % 16];

            if (this.step % 2 === 0 || Math.random() > 0.5) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.value = note;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = isBossLvl ? 280 : 180;

                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + stepTime * 0.95);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now);
                osc.stop(now + stepTime);
            }

            if (this.step % 4 === 0) {
                const kOsc = this.ctx.createOscillator();
                const kGain = this.ctx.createGain();
                kOsc.frequency.setValueAtTime(140, now);
                kOsc.frequency.exponentialRampToValueAtTime(45, now + 0.1);
                kGain.gain.setValueAtTime(0.35, now);
                kGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                kOsc.connect(kGain);
                kGain.connect(this.ctx.destination);
                kOsc.start(now);
                kOsc.stop(now + 0.1);
            }

            if (this.step % 8 === 4) {
                const bufferSize = this.ctx.sampleRate * 0.08;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 900;
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);
                noise.start(now);
            }
            this.step++;
        }, (isBossLvl ? stepTime * 0.8 : stepTime) * 1000);
    }
}
const soundManager = new SoundManager();

// --- TEXTURES & SPRITES GENERATOR ---
function generateCanvasTexture(width, height, drawFunc) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFunc(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

function buildTextures() {
    // Vibrant Neon Circuit Brick
    const wall_brick = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#100a1c'; // Dark purple/black bricks
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#00ffff'; // Neon cyan grid mortar
        for(let y=0; y<=128; y+=16) ctx.fillRect(0, y, 128, 2);
        for(let y=0; y<128; y+=16) {
            const offset = (y/16)%2 === 0 ? 0 : 16;
            for(let x=offset; x<128+offset; x+=32) {
                ctx.fillRect(x%128, y, 2, 16);
            }
        }
        // Neon cyan glows
        for(let k=0; k<30; k++) {
            ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
            ctx.fillRect(Math.random()*128, Math.random()*128, 3, 3);
        }
    });

    // Metallic Cyan Grid
    const wall_metal = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#181924';
        ctx.fillRect(0,0,128,128);
        // Bright cyan frames
        ctx.fillStyle = '#00aaff';
        ctx.fillRect(0, 0, 128, 4);
        ctx.fillRect(0, 0, 4, 128);
        ctx.fillRect(124, 0, 4, 128);
        ctx.fillRect(0, 124, 128, 4);
        // glowing grid lines
        ctx.strokeStyle = '#0055aa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for(let i=16; i<128; i+=16) {
            ctx.moveTo(i, 0); ctx.lineTo(i, 128);
            ctx.moveTo(0, i); ctx.lineTo(128, i);
        }
        ctx.stroke();
        // Bright magenta rivets
        ctx.fillStyle = '#ff00aa';
        ctx.fillRect(6, 6, 4, 4); ctx.fillRect(118, 6, 4, 4);
        ctx.fillRect(6, 118, 4, 4); ctx.fillRect(118, 118, 4, 4);
    });

    // Vibrant Neon Warning stripes
    const wall_caution = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#ff22aa'; // Neon pink
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#0f0515'; // Dark purple
        ctx.lineWidth = 14;
        ctx.beginPath();
        for(let i=-128; i<256; i+=32) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 128, 128);
        }
        ctx.stroke();
    });

    const wall_door = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#252636';
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#00ffcc'; // Cyan trim
        ctx.fillRect(0, 0, 128, 6);
        ctx.fillRect(0, 122, 128, 6);
        for(let y=16; y<120; y+=16) {
            ctx.fillStyle = '#111';
            ctx.fillRect(10, y, 108, 4);
            ctx.fillStyle = '#00ffcc';
            ctx.fillRect(10, y+4, 108, 2);
        }
    });

    const door_red = generateColorDoorTexture('#ff1144');
    const door_blue = generateColorDoorTexture('#0077ff');
    const door_yellow = generateColorDoorTexture('#ffcc00');

    // Cyber tile floor
    const floor_tile = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = '#0e0e15';
        ctx.fillRect(0,0,64,64);
        ctx.strokeStyle = '#22233b';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, 64, 64);
        // glowing dot center
        ctx.fillStyle = '#00aaff';
        ctx.fillRect(31, 31, 2, 2);
    });

    // Glowing Lava river texture
    const floor_slime = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = '#cc2200';
        ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#ff7700';
        for(let i=0; i<10; i++) {
            ctx.beginPath();
            ctx.arc(Math.random()*64, Math.random()*64, Math.random()*12+4, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.fillStyle = '#ffff00'; // Yellow cracks
        for(let i=0; i<15; i++) {
            ctx.fillRect(Math.random()*64, Math.random()*64, Math.random()*10+2, 2);
        }
    });

    // Vibrant skybox (Galaxy with purple cloud & neon embers)
    const sky_hell = generateCanvasTexture(512, 512, (ctx) => {
        const grd = ctx.createLinearGradient(0, 0, 0, 512);
        grd.addColorStop(0, '#060010');
        grd.addColorStop(0.5, '#20003b'); // Purple mid
        grd.addColorStop(1, '#500055'); // Magenta horizon
        ctx.fillStyle = grd;
        ctx.fillRect(0,0,512,512);
        
        // Nebula dust
        ctx.fillStyle = 'rgba(255, 0, 170, 0.1)';
        for(let i=0; i<12; i++) {
            ctx.beginPath();
            ctx.arc(Math.random()*512, Math.random()*300, Math.random()*100+50, 0, Math.PI*2);
            ctx.fill();
        }

        // Glowing stars
        ctx.fillStyle = '#00ffff';
        for(let i=0; i<80; i++) {
            ctx.fillRect(Math.random()*512, Math.random()*350, 2, 2);
        }
        ctx.fillStyle = '#ff00ff';
        for(let i=0; i<40; i++) {
            ctx.fillRect(Math.random()*512, Math.random()*350, 3, 3);
        }
    });

    return {
        wall_brick, wall_metal, wall_caution, wall_door,
        door_red, door_blue, door_yellow,
        floor_tile, floor_slime, sky_hell
    };
}

function generateColorDoorTexture(color) {
    return generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#222';
        ctx.fillRect(0,0,128,128);
        ctx.fillStyle = color;
        // Large locking plate
        ctx.fillRect(16, 16, 96, 96);
        ctx.fillStyle = '#000';
        ctx.fillRect(20, 20, 88, 88);
        // glowing symbols
        ctx.fillStyle = color;
        ctx.fillRect(40, 48, 48, 32);
        ctx.fillStyle = '#fff';
        ctx.fillRect(48, 54, 32, 20);
    });
}

function buildPickupTextures() {
    const medkit = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#00ffcc'; ctx.fillRect(4, 8, 24, 18); // Neon cyan box
        ctx.fillStyle = '#ffffff'; ctx.fillRect(14, 11, 4, 12); ctx.fillRect(10, 15, 12, 4); // White cross
    });

    const armor = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#ff00aa'; // Neon pink shield
        ctx.beginPath();
        ctx.moveTo(16, 4); ctx.lineTo(26, 8); ctx.lineTo(24, 22); ctx.lineTo(16, 28); ctx.lineTo(8, 22); ctx.lineTo(6, 8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffccff'; // Inner highlights
        ctx.beginPath();
        ctx.moveTo(16, 8); ctx.lineTo(22, 11); ctx.lineTo(20, 20); ctx.lineTo(16, 24); ctx.lineTo(12, 20); ctx.lineTo(10, 11);
        ctx.closePath(); ctx.fill();
    });

    const bullets = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#393b4a'; ctx.fillRect(6, 12, 20, 12);
        ctx.fillStyle = '#00ffff'; ctx.fillRect(9, 8, 3, 4); ctx.fillRect(14, 8, 3, 4); ctx.fillRect(19, 8, 3, 4); // Glowing tips
    });

    const shells = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#cc2200'; ctx.fillRect(6, 10, 20, 14);
        ctx.fillStyle = '#ffd700'; ctx.fillRect(8, 10, 16, 3); // Gold bases
    });

    const cells = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#0f172a'; ctx.fillRect(8, 6, 16, 20);
        ctx.fillStyle = '#00ffff'; // Glowing grid plasma cell
        ctx.fillRect(10, 8, 12, 16);
    });

    const shotgun = generateCanvasTexture(64, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,64,32);
        ctx.fillStyle = '#613000'; ctx.fillRect(10, 16, 12, 6);
        ctx.fillStyle = '#3c3d42'; ctx.fillRect(22, 14, 38, 5); // Double barrel
    });

    const plasma = generateCanvasTexture(64, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,64,32);
        ctx.fillStyle = '#1e293b'; ctx.fillRect(12, 12, 36, 10);
        ctx.fillStyle = '#00ffff'; ctx.fillRect(20, 10, 24, 2); // Neon tubes
    });

    const key_red = generateKeycardTexture('#ff2222');
    const key_blue = generateKeycardTexture('#2222ff');
    const key_yellow = generateKeycardTexture('#ffff22');

    return { medkit, armor, bullets, shells, cells, shotgun, plasma, key_red, key_blue, key_yellow };
}

function generateKeycardTexture(color) {
    return generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#222'; ctx.fillRect(10, 8, 12, 18);
        ctx.fillStyle = color; ctx.fillRect(12, 10, 8, 14);
        ctx.fillStyle = '#fff'; ctx.fillRect(14, 14, 4, 2);
    });
}

function buildEnemyTextures() {
    const list = {};
    const enemyTypes = {
        soldier: { color: '#00cc55', eyeColor: '#ff2222', size: 64 }, // vibrant green soldier
        imp: { color: '#cc6600', eyeColor: '#ff00ff', size: 64 }, // fiery orange imp
        pinky: { color: '#ff00aa', eyeColor: '#ffffff', size: 80 }, // hot pink pinky
        boss: { color: '#e60000', eyeColor: '#00ffff', size: 128 } // giant crimson Cyber-Demon
    };

    for(let type in enemyTypes) {
        const info = enemyTypes[type];
        
        list[`${type}_walk1`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
            drawEnemyBase(ctx, type, info, w, h, 'walk1');
        });
        list[`${type}_walk2`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
            drawEnemyBase(ctx, type, info, w, h, 'walk2');
        });
        list[`${type}_attack`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
            drawEnemyBase(ctx, type, info, w, h, 'attack');
        });
        list[`${type}_hurt`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
            drawEnemyBase(ctx, type, info, w, h, 'hurt');
        });
        list[`${type}_dead`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
            drawEnemyBase(ctx, type, info, w, h, 'dead');
        });
    }
    return list;
}

function drawEnemyBase(ctx, type, info, w, h, state) {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0,0,w,h);

    if (state === 'dead') {
        ctx.fillStyle = '#cc0022';
        ctx.beginPath(); ctx.ellipse(w/2, h - 8, w/3, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = info.color;
        ctx.fillRect(w/4, h - 14, w/2, 8);
        ctx.fillStyle = '#cc9988';
        ctx.beginPath(); ctx.arc(w/4 + 4, h - 14, 5, 0, Math.PI*2); ctx.fill();
        return;
    }

    const cx = w / 2;
    const isPinky = type === 'pinky';
    const isBoss = type === 'boss';

    // 1. Legs
    ctx.fillStyle = (isPinky || isBoss) ? info.color : '#251c14';
    if (state === 'walk1') {
        ctx.fillRect(cx - 8, h - 16, 5, 16);
        ctx.fillRect(cx + 3, h - 12, 5, 12);
    } else if (state === 'walk2') {
        ctx.fillRect(cx - 8, h - 12, 5, 12);
        ctx.fillRect(cx + 3, h - 16, 5, 16);
    } else {
        ctx.fillRect(cx - 7, h - 14, 5, 14);
        ctx.fillRect(cx + 2, h - 14, 5, 14);
    }

    // 2. Torso
    ctx.fillStyle = info.color;
    if (isPinky) {
        ctx.fillRect(cx - 16, h - 38, 32, 24);
    } else if (isBoss) {
        // Gigantic muscle frame
        ctx.fillRect(cx - 24, h - 68, 48, 48);
        // Cybernetic plating
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(cx - 16, h - 60, 10, 24);
    } else {
        ctx.fillRect(cx - 10, h - 34, 20, 20);
    }

    // 3. Head
    ctx.fillStyle = (isPinky || isBoss) ? info.color : '#e6b39a';
    const headY = isBoss ? h - 76 : (isPinky ? h - 34 : h - 42);
    const headRad = isBoss ? 16 : (isPinky ? 9 : 7);
    ctx.beginPath();
    ctx.arc(cx, headY, headRad, 0, Math.PI*2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = info.eyeColor;
    if (isPinky || isBoss) {
        ctx.fillRect(cx - 6, headY - 3, 2, 2);
        ctx.fillRect(cx + 4, headY - 3, 2, 2);
    } else {
        ctx.fillRect(cx - 3, headY - 2, 2, 2);
        ctx.fillRect(cx + 2, headY - 2, 2, 2);
    }

    // Mouth / Cybernetic enhancements
    if (isBoss) {
        ctx.fillStyle = '#333';
        ctx.fillRect(cx - 8, headY + 4, 16, 6); // steel mouth guard
        // Horns
        ctx.fillStyle = '#eee';
        ctx.beginPath(); ctx.moveTo(cx - 12, headY - 10); ctx.lineTo(cx - 20, headY - 25); ctx.lineTo(cx - 8, headY - 14); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + 12, headY - 10); ctx.lineTo(cx + 20, headY - 25); ctx.lineTo(cx + 8, headY - 14); ctx.fill();
    } else if (isPinky) {
        ctx.fillStyle = '#000';
        ctx.fillRect(cx - 4, headY + 2, 8, 4);
        if (state === 'attack') {
            ctx.fillStyle = '#ff0033';
            ctx.fillRect(cx - 4, headY + 2, 8, 5);
        }
    }

    // 4. Arms
    ctx.fillStyle = info.color;
    if (state === 'attack') {
        if (type === 'soldier') {
            ctx.fillStyle = '#00ffff'; // neon muzzle flash
            ctx.beginPath(); ctx.arc(cx - 16, h - 26, 6, 0, Math.PI*2); ctx.fill();
        } else if (type === 'imp') {
            // Hot orange ball
            ctx.fillStyle = '#ff6600';
            ctx.beginPath(); ctx.arc(cx, h - 48, 8, 0, Math.PI*2); ctx.fill();
        } else if (isBoss) {
            // Cyber Arm fires dual glowing rockets
            ctx.fillStyle = '#00ffff';
            ctx.fillRect(cx - 34, h - 56, 12, 30); // arm gun
            ctx.fillStyle = '#ff3300'; // huge flash
            ctx.beginPath(); ctx.arc(cx - 28, h - 60, 16, 0, Math.PI*2); ctx.fill();
        }
    } else {
        if (isBoss) {
            ctx.fillRect(cx - 32, h - 56, 8, 28);
            ctx.fillStyle = '#333'; ctx.fillRect(cx + 24, h - 56, 8, 28); // metallic right claw
        } else {
            ctx.fillRect(cx - 14, h - 30, 4, 12);
            ctx.fillRect(cx + 10, h - 30, 4, 12);
        }
    }

    if (state === 'hurt') {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.45)';
        ctx.fillRect(0,0,w,h);
    }
}

function buildWeaponHUDCanvasses() {
    const list = {};
    const weaponKeys = [
        'fist_idle', 'fist_punch1', 'fist_punch2',
        'pistol_idle', 'pistol_fire1', 'pistol_fire2',
        'shotgun_idle', 'shotgun_fire', 'shotgun_pump1', 'shotgun_pump2',
        'plasma_idle', 'plasma_fire1', 'plasma_fire2'
    ];

    weaponKeys.forEach(key => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 320;
        const ctx = canvas.getContext('2d');
        drawHUDWeapon(ctx, key);
        list[key] = canvas.toDataURL();
    });
    return list;
}

function drawHUDWeapon(ctx, key) {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0,0,320,320);
    const w = 320, h = 320;

    if (key.startsWith('fist')) {
        ctx.fillStyle = '#d2997a';
        if (key === 'fist_idle') {
            ctx.fillRect(w - 100, h - 100, 70, 100);
            ctx.fillStyle = '#b3775c';
            ctx.fillRect(w - 100, h - 100, 70, 12);
        } else if (key === 'fist_punch1') {
            ctx.fillRect(w - 70, h - 60, 70, 80);
        } else {
            ctx.fillRect(w / 2 - 60, h - 180, 120, 120);
            ctx.fillStyle = '#b3775c';
            ctx.fillRect(w / 2 - 60, h - 180, 120, 30);
        }
    } else if (key.startsWith('pistol')) {
        ctx.fillStyle = '#7a5a4a'; ctx.fillRect(w/2 - 24, h - 60, 48, 60);
        ctx.fillStyle = '#00ffcc'; // Cybernetic trim
        ctx.fillRect(w/2 - 16, h - 140, 32, 90);

        if (key === 'pistol_fire1') {
            ctx.translate(0, -15);
            ctx.fillStyle = '#00ffff';
            ctx.beginPath(); ctx.arc(w/2, h - 165, 22, 0, Math.PI*2); ctx.fill();
        } else if (key === 'pistol_fire2') {
            ctx.translate(0, -8);
        }
    } else if (key.startsWith('shotgun')) {
        ctx.fillStyle = '#111';
        ctx.fillRect(w/2 - 24, h - 160, 48, 160);
        ctx.fillStyle = '#ff00aa'; // Magenta glowing accents
        ctx.fillRect(w/2 - 12, h - 220, 10, 120);
        ctx.fillRect(w/2 + 2, h - 220, 10, 120);

        if (key === 'shotgun_fire') {
            ctx.translate(0, -25);
            ctx.fillStyle = '#ff00aa';
            ctx.beginPath(); ctx.arc(w/2, h - 235, 45, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(w/2, h - 235, 20, 0, Math.PI*2); ctx.fill();
        } else if (key === 'shotgun_pump1') {
            ctx.translate(-15, 10);
            ctx.rotate(-0.05);
            ctx.fillStyle = '#d2997a';
            ctx.fillRect(w/2 - 18, h - 130, 20, 30);
        } else if (key === 'shotgun_pump2') {
            ctx.translate(15, 12);
            ctx.rotate(0.05);
            ctx.fillStyle = '#d2997a';
            ctx.fillRect(w/2 - 2, h - 130, 20, 30);
        }
    } else if (key.startsWith('plasma')) {
        ctx.fillStyle = '#333';
        ctx.fillRect(w/2 - 30, h - 160, 60, 160);
        ctx.fillStyle = '#00ffff'; // Neon plasma barrel
        ctx.fillRect(w/2 - 18, h - 180, 36, 120);

        if (key === 'plasma_fire1') {
            ctx.translate(0, -8);
            ctx.fillStyle = '#00ffff';
            ctx.beginPath(); ctx.arc(w/2, h - 190, 25, 0, Math.PI*2); ctx.fill();
        } else if (key === 'plasma_fire2') {
            ctx.translate(0, -4);
            ctx.fillStyle = '#00aaff';
            ctx.beginPath(); ctx.arc(w/2, h - 190, 18, 0, Math.PI*2); ctx.fill();
        }
    }
}

let faceCtx, faceCanvas;
function drawHUDFace(health, expression = 'idle') {
    if (!faceCtx) {
        faceCanvas = document.getElementById('face-canvas');
        if (!faceCanvas) return;
        faceCtx = faceCanvas.getContext('2d');
    }

    const w = 48, h = 56;
    faceCtx.fillStyle = '#141414';
    faceCtx.fillRect(0,0,w,h);

    const isDead = health <= 0;
    faceCtx.fillStyle = isDead ? '#555' : '#f2c199';
    faceCtx.fillRect(8, 12, 32, 36);

    if (!isDead) {
        faceCtx.fillStyle = '#00ffff'; // Cyberpunk glowing hair!
        faceCtx.fillRect(8, 12, 32, 10);
        faceCtx.fillRect(6, 14, 4, 14);
        faceCtx.fillRect(38, 14, 4, 14);
    }

    faceCtx.fillStyle = '#000';
    let eyeLOffset = 0, eyeROffset = 0;
    if (expression === 'look_left') { eyeLOffset = -2; eyeROffset = -2; }
    if (expression === 'look_right') { eyeLOffset = 2; eyeROffset = 2; }

    if (isDead) {
        faceCtx.strokeStyle = '#ff0033'; faceCtx.lineWidth = 2;
        faceCtx.beginPath();
        faceCtx.moveTo(14, 24); faceCtx.lineTo(20, 30);
        faceCtx.moveTo(20, 24); faceCtx.lineTo(14, 30);
        faceCtx.moveTo(28, 24); faceCtx.lineTo(34, 30);
        faceCtx.moveTo(34, 24); faceCtx.lineTo(28, 30);
        faceCtx.stroke();
    } else {
        faceCtx.fillStyle = '#fff';
        faceCtx.fillRect(14, 24, 6, 6);
        faceCtx.fillRect(28, 24, 6, 6);
        faceCtx.fillStyle = '#ff0055'; // Neon pink eyes
        faceCtx.fillRect(16 + eyeLOffset, 26, 2, 2);
        faceCtx.fillRect(30 + eyeROffset, 26, 2, 2);
    }

    faceCtx.fillStyle = isDead ? '#333' : '#e09870';
    faceCtx.fillRect(22, 30, 4, 6);

    if (isDead) {
        faceCtx.fillStyle = '#222';
        faceCtx.fillRect(16, 42, 16, 4);
    } else if (expression === 'wince') {
        faceCtx.fillStyle = '#aa0000';
        faceCtx.fillRect(16, 40, 16, 8);
    } else if (expression === 'grin') {
        faceCtx.fillStyle = '#000';
        faceCtx.fillRect(16, 42, 16, 2);
        faceCtx.fillRect(14, 38, 2, 4);
        faceCtx.fillRect(32, 38, 2, 4);
    } else {
        faceCtx.fillStyle = '#000';
        faceCtx.fillRect(18, 42, 12, 2);
    }

    if (!isDead) {
        faceCtx.fillStyle = '#ff0055';
        if (health < 75) faceCtx.fillRect(10, 16, 2, 6);
        if (health < 50) faceCtx.fillRect(22, 36, 4, 3);
        if (health < 25) {
            faceCtx.fillRect(10, 32, 6, 2);
            faceCtx.fillStyle = 'rgba(255, 0, 85, 0.3)';
            faceCtx.fillRect(8, 12, 32, 36);
        }
    }
}

// --- DYNAMIC LEVEL GENERATOR ---

function loadLevel(levelNum) {
    currentLevel = levelNum;
    levelKillCount = 0;
    portalActive = false;
    bossEntity = null;

    // Reset overlay colors
    document.getElementById('boss-hud').style.display = 'none';

    // Restart music to apply level-specific speed adjustments
    if (soundManager.musicInterval) {
        clearInterval(soundManager.musicInterval);
        soundManager.musicPlaying = false;
        soundManager.startMusic();
    }

    // Clear old Level entities
    walls.forEach(w => scene.remove(w));
    doors.forEach(d => scene.remove(d.mesh));
    pickups.forEach(p => scene.remove(p.mesh));
    enemies.forEach(e => scene.remove(e.mesh));
    projectiles.forEach(pr => scene.remove(pr.mesh));
    particles.forEach(p => scene.remove(p));
    lightObjects.forEach(l => scene.remove(l));

    walls = [];
    doors = [];
    pickups = [];
    enemies = [];
    projectiles = [];
    particles = [];
    lightObjects = [];

    // Objective text updates
    const title = document.getElementById('level-num');
    const desc = document.getElementById('level-objective');

    if (levelNum === 1) {
        title.innerText = "LEVEL 1: RUINS WASTELAND";
        desc.innerText = "Eliminate 8 Soldier Demons to open exit portal!";
        scene.fog.color.setHex(0x0e0202);
        renderer.setClearColor(0x0e0202);

        // Generate Grid
        MAP_GRID = generateLevelGrid(1);

        // Spawn Entities
        spawnLevelEntities(1);
    } else if (levelNum === 2) {
        title.innerText = "LEVEL 2: THE INFERNO";
        desc.innerText = "Gather RED, BLUE, and YELLOW keys to unlock final gate!";
        scene.fog.color.setHex(0x2d0505);
        renderer.setClearColor(0x2d0505);

        // Generate Grid
        MAP_GRID = generateLevelGrid(2);

        // Spawn Entities
        spawnLevelEntities(2);
    } else if (levelNum === 3) {
        title.innerText = "LEVEL 3: HELL'S KEEP";
        desc.innerText = "BOSS BATTLE: Defeat the Cyber-Demon!";
        scene.fog.color.setHex(0x1a0202);
        renderer.setClearColor(0x1a0202);

        // Display Boss HUD
        document.getElementById('boss-hud').style.display = 'flex';
        document.getElementById('boss-health-bar').style.width = '100%';

        // Generate Grid
        MAP_GRID = generateLevelGrid(3);

        // Spawn Entities
        spawnLevelEntities(3);
    }

    // Move player to level starting spot (centered for Level 3 Colosseum to avoid circular wall spawn)
    if (levelNum === 3) {
        player.x = CELL_SIZE * 10.5;
        player.z = CELL_SIZE * 3.5;
    } else {
        player.x = CELL_SIZE * 2.5;
        player.z = CELL_SIZE * 2.5;
    }
    if (yawObject) {
        yawObject.position.set(player.x, 8, player.z);
    }

    // Sync status indicators
    player.keys.red = false;
    player.keys.blue = false;
    player.keys.yellow = false;
    document.getElementById('red-key-card').classList.remove('active');
    document.getElementById('blue-key-card').classList.remove('active');
    document.getElementById('yellow-key-card').classList.remove('active');
    updateHUDStats();

    // Rebuild 3D wall and door meshes for the newly loaded level map
    parseMapGrid();
}

function generateLevelGrid(level) {
    const size = level === 3 ? 20 : 30;
    const grid = [];
    for(let r=0; r<size; r++) {
        const row = [];
        for(let c=0; c<size; c++) {
            if (r === 0 || r === size-1 || c === 0 || c === size-1) {
                row.push(level === 1 ? 1 : 2); // Brick for level 1, metal for 2/3
            } else {
                row.push(0);
            }
        }
        grid.push(row);
    }

    if (level === 1) {
        // Ruins Valley: scatter pillars
        for(let i=0; i<15; i++) {
            const pr = Math.floor(4 + Math.random() * (size - 8));
            const pc = Math.floor(4 + Math.random() * (size - 8));
            grid[pr][pc] = 1;
        }
        // Exit Portal cell
        grid[size - 2][size - 3] = 9;
    } else if (level === 2) {
        // Volcanic Core: lava river at column 14
        for(let r=1; r<size-1; r++) {
            grid[r][14] = 10; // Lava tile (value 10)
        }
        grid[8][14] = 0; // bridge
        grid[22][14] = 0; // bridge

        // Key rooms partitions (Doom-style progression chain)
        // Red room top-left (contains Red key, locked behind standard door)
        for(let r=1; r<6; r++) grid[r][6] = 2;
        for(let c=1; c<6; c++) grid[6][c] = 2;
        grid[6][3] = 4; // standard door

        // Blue room bottom-left (contains Blue key, locked behind Red door)
        for(let r=size-7; r<size-1; r++) grid[r][6] = 2;
        for(let c=1; c<6; c++) grid[size-7][c] = 2;
        grid[size-7][3] = 5; // red locked door

        // Yellow room top-right (contains Yellow key, locked behind Blue door)
        for(let r=1; r<6; r++) grid[r][size-7] = 2;
        for(let c=size-7; c<size-1; c++) grid[6][c] = 2;
        grid[6][size-4] = 6; // blue locked door

        // Central exit gate (contains portal to Level 3, locked behind Yellow door)
        grid[size-6][size-6] = 2;
        grid[size-7][size-6] = 2;
        grid[size-6][size-7] = 2;
        grid[size-6][size-6] = 7; // yellow locked door
        grid[size-4][size-4] = 9; // level portal
    } else if (level === 3) {
        // Colosseum ring
        const center = size / 2;
        const rad = size / 2 - 1.5;
        for(let r=0; r<size; r++) {
            for(let c=0; c<size; c++) {
                const dist = Math.sqrt((r - center)**2 + (c - center)**2);
                if (dist > rad) {
                    grid[r][c] = 2;
                }
            }
        }
        grid[4][4] = 3; grid[4][size-5] = 3;
        grid[size-5][4] = 3; grid[size-5][size-5] = 3;
    }
    return grid;
}

function spawnLevelEntities(level) {
    const size = level === 3 ? 20 : 30;

    if (level === 1) {
        // 8 soldiers
        let spawned = 0;
        let attempts = 0;
        while (spawned < 8 && attempts < 100) {
            const tr = Math.floor(4 + Math.random() * (size - 8));
            const tc = Math.floor(4 + Math.random() * (size - 8));
            if (MAP_GRID[tr] && MAP_GRID[tr][tc] === 0 && (tr > 5 || tc > 5)) {
                spawnEnemy('soldier', tc, tr);
                spawned++;
            }
            attempts++;
        }
        spawnPickup('shotgun', 5, 5);
        spawnPickup('medkit', 6, 8);
        spawnPickup('armor', 8, 6);
        spawnPickup('shells', 6, 6);
    } else if (level === 2) {
        // Keys inside corner rooms
        spawnPickup('key_red', 3, 3);
        spawnPickup('key_blue', 3, size - 4);
        spawnPickup('key_yellow', size - 4, 3);

        // Heavy weapons
        spawnPickup('plasma', 10, 10);
        spawnPickup('cells', 11, 10);

        // Guards
        spawnEnemy('imp', 4, 4);
        spawnEnemy('pinky', 4, size - 3);
        spawnEnemy('imp', size - 3, 4);

        // General spawns
        for(let i=0; i<6; i++) {
            spawnEnemyAtRandom('soldier', size);
            spawnEnemyAtRandom('imp', size);
            spawnEnemyAtRandom('pinky', size);
        }
    } else if (level === 3) {
        // Spawn boss
        spawnBoss(size / 2, size / 2);
        
        // Caches
        spawnPickup('plasma', 4, 10);
        spawnPickup('cells', 5, 10);
        spawnPickup('medkit', 10, 4);
        spawnPickup('medkit', 10, size - 5);
        spawnPickup('armor', size - 5, 10);
    }
}

function spawnEnemyAtRandom(type, size) {
    let attempts = 0;
    while (attempts < 50) {
        let r = Math.floor(5 + Math.random() * (size - 10));
        let c = Math.floor(5 + Math.random() * (size - 10));
        if (MAP_GRID[r] && MAP_GRID[r][c] === 0) {
            spawnEnemy(type, c, r);
            break;
        }
        attempts++;
    }
}

function spawnEnemy(type, tx, tz) {
    let defaultTex = enemyTextures[`${type}_walk1`];
    const mat = new THREE.SpriteMaterial({ map: defaultTex, color: 0xffffff });
    const sprite = new THREE.Sprite(mat);
    
    let scale = type === 'pinky' ? 10 : 8;
    sprite.scale.set(scale, scale, 1);
    
    const px = tx * CELL_SIZE + CELL_SIZE/2;
    const pz = tz * CELL_SIZE + CELL_SIZE/2;
    sprite.position.set(px, scale/2, pz);
    scene.add(sprite);

    enemies.push({
        mesh: sprite,
        type: type,
        health: type === 'pinky' ? 120 : (type === 'imp' ? 60 : 35),
        maxHealth: type === 'pinky' ? 120 : (type === 'imp' ? 60 : 35),
        state: 'idle',
        col: tx,
        row: tz,
        timer: 0,
        speed: type === 'pinky' ? 24.0 : 14.0, // Flipped up speeds for fierce tracking
        x: px,
        z: pz
    });
}

function spawnBoss(tx, tz) {
    let defaultTex = enemyTextures.boss_walk1;
    const mat = new THREE.SpriteMaterial({ map: defaultTex, color: 0xffffff });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(22, 22, 1); // Giant Boss!

    const px = tx * CELL_SIZE + CELL_SIZE/2;
    const pz = tz * CELL_SIZE + CELL_SIZE/2;
    sprite.position.set(px, 11, pz);
    scene.add(sprite);

    bossEntity = {
        mesh: sprite,
        type: 'boss',
        health: 500,
        maxHealth: 500,
        state: 'idle',
        col: tx,
        row: tz,
        timer: 0,
        speed: 16.0, // Fiercer boss speed
        x: px,
        z: pz
    };
    enemies.push(bossEntity);
}

function spawnPickup(type, tx, tz) {
    let tex = pickupTextures[type];
    const mat = new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(6, 6, 1);
    
    const px = tx * CELL_SIZE + CELL_SIZE/2;
    const pz = tz * CELL_SIZE + CELL_SIZE/2;
    sprite.position.set(px, 3, pz);
    scene.add(sprite);

    pickups.push({
        mesh: sprite,
        type: type,
        col: tx,
        row: tz
    });

    // Add colored modern light near weapons/keys
    let color = 0x00ffff;
    if (type.startsWith('key')) color = type === 'key_red' ? 0xff0000 : (type === 'key_blue' ? 0x0000ff : 0xffff00);
    if (type === 'shotgun') color = 0xff00ff;
    
    const light = new THREE.PointLight(color, 1.0, 16);
    light.position.set(px, 3, pz);
    scene.add(light);
    lightObjects.push(light);
}

function parseMapGrid() {
    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, 20, CELL_SIZE);

    // Ceiling Plane
    if (!ceilMesh) {
        const ceilGeo = new THREE.PlaneGeometry(600, 600);
        const ceilMat = new THREE.MeshBasicMaterial({ color: 0x11071e, side: THREE.DoubleSide });
        ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
        ceilMesh.rotation.x = Math.PI / 2;
        ceilMesh.position.set(180, 20, 180);
        scene.add(ceilMesh);
    } else {
        ceilMesh.material.color.setHex(currentLevel === 2 ? 0x2d0505 : (currentLevel === 3 ? 0x150202 : 0x11071e));
    }

    // Floor Plane
    if (!floorMesh) {
        const floorGeo = new THREE.PlaneGeometry(600, 600);
        const floorMat = new THREE.MeshLambertMaterial({ map: sceneTextures.floor_tile });
        floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(180, 0, 180);
        scene.add(floorMesh);
    } else {
        floorMesh.material.map = currentLevel === 2 ? sceneTextures.floor_slime : sceneTextures.floor_tile;
        floorMesh.material.needsUpdate = true;
    }
    
    // Parse level geometries
    for (let r = 0; r < MAP_GRID.length; r++) {
        for (let c = 0; c < MAP_GRID[r].length; c++) {
            const val = MAP_GRID[r][c];
            const px = c * CELL_SIZE + CELL_SIZE / 2;
            const pz = r * CELL_SIZE + CELL_SIZE / 2;

            if (val === 1 || val === 2 || val === 3) {
                let tex = sceneTextures.wall_brick;
                if (val === 2) tex = sceneTextures.wall_metal;
                if (val === 3) tex = sceneTextures.wall_caution;
                const mat = new THREE.MeshLambertMaterial({ map: tex });
                const mesh = new THREE.Mesh(wallGeo, mat);
                mesh.position.set(px, 10, pz);
                scene.add(mesh);
                walls.push(mesh);
            } else if (val >= 4 && val <= 7) {
                let tex = sceneTextures.wall_door;
                if (val === 5) tex = sceneTextures.door_red;
                if (val === 6) tex = sceneTextures.door_blue;
                if (val === 7) tex = sceneTextures.door_yellow;

                const doorMesh = new THREE.Mesh(
                    new THREE.BoxGeometry(CELL_SIZE, 20, CELL_SIZE - 1.5), 
                    new THREE.MeshLambertMaterial({ map: tex })
                );
                doorMesh.position.set(px, 10, pz);
                scene.add(doorMesh);
                doors.push({
                    mesh: doorMesh,
                    state: 'closed',
                    col: c,
                    row: r,
                    type: val,
                    speed: 15,
                    height: 10,
                    timer: 0
                });
            } else if (val === 9) {
                // Portal mesh (Vibrant glowing neon portal)
                const portGeo = new THREE.BoxGeometry(CELL_SIZE - 2, 20, 2);
                const portMat = new THREE.MeshBasicMaterial({ color: 0x9900ff, transparent: true, opacity: 0.85 });
                const portal = new THREE.Mesh(portGeo, portMat);
                portal.position.set(px, 10, pz);
                scene.add(portal);
                
                // Add glowing light
                const portLight = new THREE.PointLight(0x9900ff, 2.0, 30);
                portLight.position.set(px, 10, pz);
                scene.add(portLight);
                lightObjects.push(portLight);
            }
        }
    }
}

// --- PHYSICS, COLLISION & MOVEMENT ---

function checkWallCollision(px, pz, radius = 2.5) {
    const cc = Math.floor(px / CELL_SIZE);
    const cr = Math.floor(pz / CELL_SIZE);

    for(let r = cr - 1; r <= cr + 1; r++) {
        for(let c = cc - 1; c <= cc + 1; c++) {
            if (r < 0 || r >= MAP_GRID.length || c < 0 || c >= MAP_GRID[0].length) continue;
            
            const cellVal = MAP_GRID[r][c];
            let block = false;

            if (cellVal === 1 || cellVal === 2 || cellVal === 3) {
                block = true;
            } else if (cellVal >= 4 && cellVal <= 7) {
                const dr = doors.find(d => d.col === c && d.row === r);
                if (dr && (dr.state === 'closed' || dr.state === 'closing')) {
                    block = true;
                }
            }

            if (block) {
                const minX = c * CELL_SIZE;
                const maxX = (c + 1) * CELL_SIZE;
                const minZ = r * CELL_SIZE;
                const maxZ = (r + 1) * CELL_SIZE;

                const cx = Math.max(minX, Math.min(px, maxX));
                const cz = Math.max(minZ, Math.min(pz, maxZ));

                const dist = Math.sqrt((px - cx)**2 + (pz - cz)**2);
                if (dist < radius) {
                    return { hit: true, cx, cz };
                }
            }
        }
    }
    return { hit: false };
}

function updatePlayerMovement(delta) {
    velocity.x -= velocity.x * 9.0 * delta;
    velocity.z -= velocity.z * 9.0 * delta;

    const theta = yawObject.rotation.y;
    const forwardX = -Math.sin(theta);
    const forwardZ = -Math.cos(theta);
    const rightX = Math.cos(theta);
    const rightZ = -Math.sin(theta);

    let moveDirX = 0;
    let moveDirZ = 0;

    if (moveForward) { moveDirX += forwardX; moveDirZ += forwardZ; }
    if (moveBackward) { moveDirX -= forwardX; moveDirZ -= forwardZ; }
    if (moveLeft) { moveDirX -= rightX; moveDirZ -= rightZ; }
    if (moveRight) { moveDirX += rightX; moveDirZ += rightZ; }

    const len = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
    if (len > 0) {
        moveDirX /= len;
        moveDirZ /= len;
    }

    // Slower pacing speed config
    const targetSpeed = 75.0;
    if (moveForward || moveBackward || moveLeft || moveRight) {
        velocity.x += moveDirX * targetSpeed * 9.0 * delta;
        velocity.z += moveDirZ * targetSpeed * 9.0 * delta;
    }

    const moveX = velocity.x * delta;
    const moveZ = velocity.z * delta;

    // Slide check
    let nextX = yawObject.position.x + moveX;
    let nextZ = yawObject.position.z;
    if (!checkWallCollision(nextX, nextZ, 2.5).hit) {
        yawObject.position.x = nextX;
    }

    nextX = yawObject.position.x;
    nextZ = yawObject.position.z + moveZ;
    if (!checkWallCollision(nextX, nextZ, 2.5).hit) {
        yawObject.position.z = nextZ;
    }

    player.x = yawObject.position.x;
    player.z = yawObject.position.z;

    const currentCol = Math.floor(player.x / CELL_SIZE);
    const currentRow = Math.floor(player.z / CELL_SIZE);

    // Environmental Lava River Hazard check
    if (MAP_GRID[currentRow] && MAP_GRID[currentRow][currentCol] === 10) {
        playerTakeDamage(25 * delta);
    }

    // Portal Zone Auto-Trigger Check
    if (MAP_GRID[currentRow] && MAP_GRID[currentRow][currentCol] === 9) {
        const now = performance.now();
        if (currentLevel === 1) {
            if (levelKillCount >= levelObjectiveKills) {
                soundManager.playSound('win');
                loadLevel(2);
            } else {
                if (now - lastPortalMsgTime > 1500) {
                    showMiddleMessage(`ELIMINATE ${levelObjectiveKills - levelKillCount} MORE DEMONS!`, "red");
                    lastPortalMsgTime = now;
                }
            }
        } else if (currentLevel === 2) {
            if (player.keys.red && player.keys.blue && player.keys.yellow) {
                soundManager.playSound('win');
                loadLevel(3);
            } else {
                if (now - lastPortalMsgTime > 1500) {
                    showMiddleMessage("COLLECT ALL THREE KEYCARDS FIRST!", "yellow");
                    lastPortalMsgTime = now;
                }
            }
        }
    }
}

// Door Triggering
function interactDoor() {
    const forwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(yawObject.quaternion).normalize();
    const checkDist = 14;
    const targetX = yawObject.position.x + forwardVec.x * checkDist;
    const targetZ = yawObject.position.z + forwardVec.z * checkDist;

    const col = Math.floor(targetX / CELL_SIZE);
    const row = Math.floor(targetZ / CELL_SIZE);

    if (row < 0 || row >= MAP_GRID.length || col < 0 || col >= MAP_GRID[0].length) return;
    const cellVal = MAP_GRID[row][col];

    if (cellVal >= 4 && cellVal <= 7) {
        const dr = doors.find(d => d.col === col && d.row === row);
        if (dr && dr.state === 'closed') {
            if (dr.type === 5 && !player.keys.red) {
                soundManager.playSound('door_buzz');
                showMiddleMessage("RED KEYCARD REQUIRED!", "red");
                return;
            }
            if (dr.type === 6 && !player.keys.blue) {
                soundManager.playSound('door_buzz');
                showMiddleMessage("BLUE KEYCARD REQUIRED!", "blue");
                return;
            }
            if (dr.type === 7 && !player.keys.yellow) {
                soundManager.playSound('door_buzz');
                showMiddleMessage("YELLOW KEYCARD REQUIRED!", "yellow");
                return;
            }

            dr.state = 'opening';
            soundManager.playSound('door');
        }
    } else if (cellVal === 9) {
        // Level Portal interaction
        if (currentLevel === 1) {
            if (levelKillCount >= levelObjectiveKills) {
                soundManager.playSound('win');
                loadLevel(2);
            } else {
                soundManager.playSound('door_buzz');
                showMiddleMessage(`ELIMINATE ${levelObjectiveKills - levelKillCount} MORE DEMONS!`, "red");
            }
        } else if (currentLevel === 2) {
            if (player.keys.red && player.keys.blue && player.keys.yellow) {
                soundManager.playSound('win');
                loadLevel(3);
            } else {
                soundManager.playSound('door_buzz');
                showMiddleMessage("COLLECT ALL THREE KEYCARDS FIRST!", "yellow");
            }
        }
    }
}

function showMiddleMessage(text, colorClass) {
    const overlay = document.getElementById('item-flash');
    overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.15)';
    overlay.style.opacity = 1;
    setTimeout(() => overlay.style.opacity = 0, 400);

    const msg = document.createElement('div');
    msg.style.position = 'absolute';
    msg.style.top = '40%';
    msg.style.left = '50%';
    msg.style.transform = 'translate(-50%, -50%)';
    msg.style.color = colorClass === 'red' ? '#ff3333' : (colorClass === 'blue' ? '#3333ff' : '#ffff33');
    msg.style.fontSize = '14px';
    msg.style.fontWeight = 'bold';
    msg.innerText = text;
    msg.style.zIndex = 15;
    document.getElementById('game-container').appendChild(msg);
    setTimeout(() => msg.remove(), 1600);
}

// --- WEAPONS & COMBAT ---
let nextShootTime = 0;
let activeFiringFrames = 0;

function shoot() {
    const now = performance.now();
    if (now < nextShootTime) return;

    const activeWep = WEAPONS_STATS[player.activeWeaponIdx];
    
    if (activeWep.ammoType !== 'none') {
        if (player.ammo[activeWep.ammoType] <= 0) {
            soundManager.playSound('door_buzz');
            return;
        }
        player.ammo[activeWep.ammoType]--;
        updateHUDStats();
    }

    soundManager.playSound(activeWep.sound);
    nextShootTime = now + activeWep.delay;

    // Apply decoupled recoil to recoilPitch variable (decays in animate loop)
    recoilPitch = Math.min(0.12, recoilPitch + 0.04);
    activeFiringFrames = 4;

    if (activeWep.key === 'plasma') {
        spawnPlasmaBall();
    } else if (activeWep.key === 'shotgun') {
        for (let i = 0; i < 5; i++) {
            const spreadX = (Math.random() - 0.5) * 0.08;
            const spreadY = (Math.random() - 0.5) * 0.05;
            raycastAttack(spreadX, spreadY, activeWep.damage / 4);
        }
    } else {
        raycastAttack(0, 0, activeWep.damage);
    }
}

function raycastAttack(spreadX, spreadY, damage) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(spreadX, spreadY), camera);
    raycaster.far = player.activeWeaponIdx === 0 ? 10 : 150;

    const enemyMeshes = enemies.filter(e => e.state !== 'dead').map(e => e.mesh);
    const hitEnemies = raycaster.intersectObjects(enemyMeshes);

    const hitWalls = raycaster.intersectObjects(walls);
    let hitDoors = [];
    doors.forEach(d => {
        if (d.state === 'closed' || d.state === 'closing') {
            hitDoors.push(...raycaster.intersectObject(d.mesh));
        }
    });

    let closestBlockedDist = Infinity;
    hitWalls.forEach(h => { if(h.distance < closestBlockedDist) closestBlockedDist = h.distance; });
    hitDoors.forEach(h => { if(h.distance < closestBlockedDist) closestBlockedDist = h.distance; });

    if (hitEnemies.length > 0 && hitEnemies[0].distance < closestBlockedDist) {
        const targetMesh = hitEnemies[0].object;
        const enemyObj = enemies.find(e => e.mesh === targetMesh);
        if (enemyObj) {
            damageEnemy(enemyObj, damage, hitEnemies[0].point);
        }
    }
}

function spawnPlasmaBall() {
    const plasmaGeo = new THREE.SphereGeometry(0.6, 6, 6);
    const plasmaMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const mesh = new THREE.Mesh(plasmaGeo, plasmaMat);

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(yawObject.quaternion).normalize();
    mesh.position.copy(yawObject.position);
    mesh.position.y -= 1;
    
    scene.add(mesh);
    projectiles.push({
        mesh,
        direction: dir,
        speed: 120.0,
        damage: 24,
        isPlayer: true
    });
}

function damageEnemy(enemy, amount, hitPoint) {
    if (enemy.state === 'dead') return;
    enemy.health -= amount;
    enemy.state = 'hurt';
    enemy.timer = 0.15;
    
    soundManager.playSound('enemy_pain');
    spawnBlood(hitPoint || enemy.mesh.position, 8);

    // Sync Boss Health Bar
    if (enemy.type === 'boss') {
        const pct = Math.max(0, (enemy.health / enemy.maxHealth) * 100);
        document.getElementById('boss-health-bar').style.width = `${pct}%`;
    }

    if (enemy.health <= 0) {
        enemy.state = 'dead';
        soundManager.playSound('enemy_death');
        spawnBlood(enemy.mesh.position, 25);
        
        if (enemy.type === 'boss') {
            document.getElementById('boss-hud').style.display = 'none';
            // Play victory sound and open win overlay
            isWin = true;
            soundManager.playSound('win');
            document.getElementById('level-win').style.display = 'flex';
            document.exitPointerLock();
        } else {
            levelKillCount++;
            updateObjectiveBoard();
            dropLoot(enemy.mesh.position, enemy.type);
        }
    }
}

function dropLoot(pos, type) {
    let lootType = 'bullets';
    if (type === 'pinky') lootType = 'medkit';
    if (type === 'imp') lootType = 'shells';

    const mat = new THREE.SpriteMaterial({ map: pickupTextures[lootType] });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(5, 5, 1);
    sprite.position.copy(pos);
    sprite.position.y = 2.5;
    scene.add(sprite);

    const col = Math.floor(pos.x / CELL_SIZE);
    const row = Math.floor(pos.z / CELL_SIZE);
    pickups.push({ mesh: sprite, type: lootType, col, row });
}

function spawnImpFireball(enemy) {
    const fireGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
    const mesh = new THREE.Mesh(fireGeo, fireMat);
    mesh.position.copy(enemy.mesh.position);
    mesh.position.y = 4;

    const dir = new THREE.Vector3().subVectors(yawObject.position, enemy.mesh.position).normalize();
    scene.add(mesh);
    projectiles.push({
        mesh,
        direction: dir,
        speed: 48.0, // faster projectile
        damage: 22, // more damage
        isPlayer: false
    });
}

function spawnBossMissile(enemy) {
    // Cyber Demon shoots larger glowing cyan rocket
    const fireGeo = new THREE.SphereGeometry(1.5, 8, 8);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff00aa }); // Magenta splash rocket
    const mesh = new THREE.Mesh(fireGeo, fireMat);
    mesh.position.copy(enemy.mesh.position);
    mesh.position.y = 8; // shoulder

    const dir = new THREE.Vector3().subVectors(yawObject.position, enemy.mesh.position).normalize();
    scene.add(mesh);
    projectiles.push({
        mesh,
        direction: dir,
        speed: 58.0, // faster missile
        damage: 32, // more damage
        isPlayer: false
    });
}

// --- COLLIDE & GRAB ITEMS ---
function updatePickups() {
    for (let i = pickups.length - 1; i >= 0; i--) {
        const item = pickups[i];
        const dist = item.mesh.position.distanceTo(yawObject.position);

        if (dist < 6) {
            let collected = false;
            switch(item.type) {
                case 'medkit':
                    if (player.health < 100) {
                        player.health = Math.min(100, player.health + 25);
                        collected = true;
                    }
                    break;
                case 'armor':
                    if (player.armor < 100) {
                        player.armor = Math.min(100, player.armor + 25);
                        collected = true;
                    }
                    break;
                case 'bullets':
                    player.ammo.pistol = Math.min(200, player.ammo.pistol + 30);
                    collected = true;
                    break;
                case 'shells':
                    player.ammo.shotgun = Math.min(50, player.ammo.shotgun + 12);
                    collected = true;
                    break;
                case 'cells':
                    player.ammo.plasma = Math.min(300, player.ammo.plasma + 60);
                    collected = true;
                    break;
                case 'shotgun':
                    player.weaponsUnlocked[2] = true;
                    player.ammo.shotgun = Math.min(50, player.ammo.shotgun + 8);
                    collected = true;
                    showMiddleMessage("YOU GOT THE SHOTGUN!", "yellow");
                    break;
                case 'plasma':
                    player.weaponsUnlocked[3] = true;
                    player.ammo.plasma = Math.min(300, player.ammo.plasma + 60);
                    collected = true;
                    showMiddleMessage("YOU GOT THE PLASMA RIFLE!", "blue");
                    break;
                case 'key_red':
                    player.keys.red = true;
                    document.getElementById('red-key-card').classList.add('active');
                    collected = true;
                    showMiddleMessage("RED KEYCARD PICKED UP", "red");
                    break;
                case 'key_blue':
                    player.keys.blue = true;
                    document.getElementById('blue-key-card').classList.add('active');
                    collected = true;
                    showMiddleMessage("BLUE KEYCARD PICKED UP", "blue");
                    break;
                case 'key_yellow':
                    player.keys.yellow = true;
                    document.getElementById('yellow-key-card').classList.add('active');
                    collected = true;
                    showMiddleMessage("YELLOW KEYCARD PICKED UP", "yellow");
                    break;
            }

            if (collected) {
                soundManager.playSound('pickup');
                scene.remove(item.mesh);
                pickups.splice(i, 1);
                
                const flash = document.getElementById('item-flash');
                flash.style.opacity = 0.55;
                setTimeout(() => flash.style.opacity = 0, 100);

                updateHUDStats();
            }
        }
    }
}

// --- PLAYER DAMAGE HANDLER ---
function playerTakeDamage(amount) {
    if (isDead || isWin) return;
    
    if (player.armor > 0) {
        const absorbed = amount * 0.5;
        player.armor = Math.max(0, player.armor - absorbed);
        player.health = Math.max(0, player.health - (amount - absorbed));
    } else {
        player.health = Math.max(0, player.health - amount);
    }

    soundManager.playSound('player_pain');
    updateHUDStats();

    const overlay = document.getElementById('damage-overlay');
    overlay.style.opacity = 0.65;
    setTimeout(() => overlay.style.opacity = 0, 150);

    currentFaceExpr = 'wince';
    faceTimer = 0.8;

    if (player.health <= 0) {
        isDead = true;
        document.getElementById('game-over').style.display = 'flex';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('minimap-container').style.display = 'none';
        document.getElementById('level-hud').style.display = 'none';
        document.getElementById('boss-hud').style.display = 'none';
        document.exitPointerLock();
    }
}

function updateHUDStats() {
    const activeWep = WEAPONS_STATS[player.activeWeaponIdx];
    
    if (activeWep.ammoType === 'none') {
        document.getElementById('ammo-val').innerText = '---';
        document.getElementById('ammo-type').innerText = 'FST';
    } else {
        let typeStr = 'PIS';
        let val = player.ammo.pistol;
        if (activeWep.ammoType === 'shotgun') { typeStr = 'SHE'; val = player.ammo.shotgun; }
        if (activeWep.ammoType === 'plasma') { typeStr = 'CEL'; val = player.ammo.plasma; }
        document.getElementById('ammo-val').innerText = val;
        document.getElementById('ammo-type').innerText = typeStr;
    }

    document.getElementById('health-val').innerText = Math.floor(player.health) + '%';
    document.getElementById('armor-val').innerText = Math.floor(player.armor) + '%';
}

function updateObjectiveBoard() {
    const desc = document.getElementById('level-objective');
    if (currentLevel === 1) {
        if (levelKillCount >= levelObjectiveKills) {
            desc.innerText = "PORTAL IS OPEN! Find the exit portal!";
            portalActive = true;
        } else {
            desc.innerText = `Eliminate ${levelObjectiveKills - levelKillCount} Soldier Demons to open portal`;
        }
    }
}

function updateWeaponUI() {
    const weaponImg = document.getElementById('weapon-img');
    const flash = document.getElementById('flash');
    const wepName = WEAPONS_STATS[player.activeWeaponIdx].key;
    
    let frameKey = `${wepName}_idle`;
    flash.style.display = 'none';

    if (activeFiringFrames > 0) {
        activeFiringFrames--;
        if (wepName === 'fist') {
            frameKey = activeFiringFrames > 2 ? 'fist_punch1' : 'fist_punch2';
        } else if (wepName === 'pistol') {
            frameKey = activeFiringFrames > 2 ? 'pistol_fire1' : 'pistol_fire2';
            if (activeFiringFrames > 2) flash.style.display = 'block';
        } else if (wepName === 'shotgun') {
            frameKey = activeFiringFrames > 2 ? 'shotgun_fire' : 'shotgun_pump1';
            if (activeFiringFrames > 2) flash.style.display = 'block';
        } else if (wepName === 'plasma') {
            frameKey = activeFiringFrames > 2 ? 'plasma_fire1' : 'plasma_fire2';
            if (activeFiringFrames > 2) flash.style.display = 'block';
        }
    }

    const dataURL = weaponImages[frameKey];
    if (dataURL && weaponImg.src !== dataURL) {
        weaponImg.src = dataURL;
    }
}

// --- ENEMY AI LOOP ---
function updateEnemies(delta, time) {
    enemies.forEach(enemy => {
        if (enemy.state === 'dead') {
            if (enemy.mesh.material.map !== enemyTextures[`${enemy.type}_dead`]) {
                enemy.mesh.material.map = enemyTextures[`${enemy.type}_dead`];
                enemy.mesh.material.needsUpdate = true;
                enemy.mesh.position.y = 0.5;
            }
            return;
        }

        const dist = enemy.mesh.position.distanceTo(yawObject.position);
        enemy.timer -= delta;

        if (enemy.state === 'hurt' && enemy.timer <= 0) {
            enemy.state = 'chase';
        }

        if (enemy.state === 'idle') {
            if (dist < 250) { // Large alert radius
                enemy.state = 'chase';
                enemy.timer = 0;
                if (enemy.type === 'boss') soundManager.playSound('boss_screamer');
            }
            enemy.mesh.material.map = enemyTextures[`${enemy.type}_walk1`];
        } else if (enemy.state === 'chase') {
            const walkFrame = Math.floor(time * 0.006) % 2 === 0 ? 'walk1' : 'walk2';
            enemy.mesh.material.map = enemyTextures[`${enemy.type}_${walkFrame}`];

            const dir = new THREE.Vector3().subVectors(yawObject.position, enemy.mesh.position);
            dir.y = 0;
            dir.normalize();

            const moveX = dir.x * enemy.speed * delta;
            const moveZ = dir.z * enemy.speed * delta;
            
            let nextX = enemy.mesh.position.x + moveX;
            let nextZ = enemy.mesh.position.z;
            if (!checkWallCollision(nextX, nextZ, enemy.type === 'boss' ? 8.0 : 3.5).hit) {
                enemy.mesh.position.x = nextX;
            }
            nextX = enemy.mesh.position.x;
            nextZ = enemy.mesh.position.z + moveZ;
            if (!checkWallCollision(nextX, nextZ, enemy.type === 'boss' ? 8.0 : 3.5).hit) {
                enemy.mesh.position.z = nextZ;
            }

            const minAttackDist = enemy.type === 'pinky' ? 7.5 : (enemy.type === 'boss' ? 75.0 : 60.0);
            if (dist < minAttackDist && enemy.timer <= 0) {
                enemy.state = 'attack';
                enemy.timer = enemy.type === 'pinky' ? 0.35 : 0.8;
            }
        } else if (enemy.state === 'attack') {
            enemy.mesh.material.map = enemyTextures[`${enemy.type}_attack`];

            if (enemy.timer <= 0) {
                if (enemy.type === 'pinky') {
                    if (dist < 8) playerTakeDamage(18);
                } else if (enemy.type === 'imp') {
                    spawnImpFireball(enemy);
                } else if (enemy.type === 'soldier') {
                    soundManager.playSound('pistol');
                    if (dist < 75) playerTakeDamage(10);
                } else if (enemy.type === 'boss') {
                    // Boss rapid fire missile barrage
                    spawnBossMissile(enemy);
                    setTimeout(() => spawnBossMissile(enemy), 150);
                    setTimeout(() => spawnBossMissile(enemy), 300);
                }
                enemy.state = 'chase';
                enemy.timer = enemy.type === 'pinky' ? 0.2 : (enemy.type === 'boss' ? 0.9 : 1.1); // Fiercer delays
            }
        }
    });
}

function spawnBlood(position, count = 10) {
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0055 }); // Glowing pinkish blood

    for(let i=0; i<count; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        mesh.userData.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 12,
            Math.random() * 8 + 4,
            (Math.random() - 0.5) * 12
        );
        scene.add(mesh);
        particles.push(mesh);
    }
}

function updateParticles(delta) {
    for(let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.velocity.y -= 26 * delta;
        p.position.addScaledVector(p.userData.velocity, delta);

        if (p.position.y < 0.2) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    }
}

function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.mesh.position.addScaledVector(proj.direction, proj.speed * delta);

        const coll = checkWallCollision(proj.mesh.position.x, proj.mesh.position.z, 0.8);
        if (coll.hit) {
            scene.remove(proj.mesh);
            projectiles.splice(i, 1);
            continue;
        }

        if (proj.isPlayer) {
            let hit = false;
            for (let e of enemies) {
                if (e.state === 'dead') continue;
                const d = proj.mesh.position.distanceTo(e.mesh.position);
                if (d < (e.type === 'boss' ? 12 : 5)) {
                    damageEnemy(e, proj.damage, proj.mesh.position);
                    hit = true;
                    break;
                }
            }
            if (hit) {
                scene.remove(proj.mesh);
                projectiles.splice(i, 1);
            }
        } else {
            const d = proj.mesh.position.distanceTo(yawObject.position);
            if (d < 5) {
                playerTakeDamage(proj.damage);
                scene.remove(proj.mesh);
                projectiles.splice(i, 1);
            }
        }
    }
}

function updateDoors(delta) {
    doors.forEach(dr => {
        if (dr.state === 'opening') {
            dr.mesh.position.y += dr.speed * delta;
            if (dr.mesh.position.y >= 26) {
                dr.mesh.position.y = 26;
                dr.state = 'open';
                dr.timer = 4.0;
            }
        } else if (dr.state === 'open') {
            dr.timer -= delta;
            if (dr.timer <= 0) {
                dr.state = 'closing';
            }
        } else if (dr.state === 'closing') {
            const px = yawObject.position.x;
            const pz = yawObject.position.z;
            const dcX = dr.col * CELL_SIZE + CELL_SIZE/2;
            const dcZ = dr.row * CELL_SIZE + CELL_SIZE/2;
            
            const dist = Math.sqrt((px - dcX)**2 + (pz - dcZ)**2);
            if (dist < 6.5) {
                dr.state = 'opening';
                return;
            }

            dr.mesh.position.y -= dr.speed * delta;
            if (dr.mesh.position.y <= 10) {
                dr.mesh.position.y = 10;
                dr.state = 'closed';
            }
        }
    });
}

// --- CONTROLS LISTENERS ---
function onMouseMove(event) {
    if (!isLocked || isDead || isWin) return;
    const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
    const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

    yawObject.rotation.y -= movementX * 0.0022;
    pitchObject.rotation.x -= movementY * 0.0022;
    // full look down clamp enabled by removing bad animate recoil settlement
    pitchObject.rotation.x = Math.max(-PI_2, Math.min(PI_2, pitchObject.rotation.x));
}

function onKeyDown(event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward = true; break;
        case 'ArrowRight': case 'KeyD': moveRight = true; break;
        case 'KeyE': case 'Space': interactDoor(); break;
        
        case 'Digit1': selectWeapon(0); break;
        case 'Digit2': selectWeapon(1); break;
        case 'Digit3': selectWeapon(2); break;
        case 'Digit4': selectWeapon(3); break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': moveRight = false; break;
    }
}

function onMouseDown() {
    if (!isLocked && !isDead && !isWin) {
        document.body.requestPointerLock();
        soundManager.init();
        return;
    }
    if (isLocked && !isDead && !isWin) shoot();
}

function selectWeapon(idx) {
    if (player.weaponsUnlocked[idx]) {
        player.activeWeaponIdx = idx;
        soundManager.playSound('pickup');
        updateHUDStats();
        currentFaceExpr = 'grin'; faceTimer = 0.8;
    } else {
        soundManager.playSound('door_buzz');
    }
}

// --- MINIMAP RENDER ---
function updateMinimap() {
    minimapCtx.fillStyle = 'rgba(10, 5, 10, 0.85)';
    minimapCtx.fillRect(0, 0, 150, 150);

    const mapScale = 0.45;
    const centerX = 75;
    const centerY = 75;
    
    // Draw cells
    for(let r = 0; r < MAP_GRID.length; r++) {
        for(let c = 0; c < MAP_GRID[r].length; c++) {
            const val = MAP_GRID[r][c];
            if (val === 0) continue;
            
            const dx = (c * CELL_SIZE + CELL_SIZE/2 - player.x) * mapScale;
            const dy = (r * CELL_SIZE + CELL_SIZE/2 - player.z) * mapScale;

            if (Math.abs(dx) < 70 && Math.abs(dy) < 70) {
                if (val >= 1 && val <= 3) {
                    minimapCtx.fillStyle = '#4c5d64';
                } else if (val >= 4 && val <= 7) {
                    const dr = doors.find(d => d.col === c && d.row === r);
                    minimapCtx.fillStyle = (dr && dr.mesh.position.y > 15) ? '#003c00' : '#bb0000';
                } else if (val === 9) {
                    minimapCtx.fillStyle = '#9900ff'; // glowing portal on map
                } else if (val === 10) {
                    minimapCtx.fillStyle = '#ff3300'; // lava river warning
                }
                minimapCtx.fillRect(centerX + dx - 3, centerY + dy - 3, 6, 6);
            }
        }
    }

    // Enemies (Red/Pink dots)
    minimapCtx.fillStyle = '#ff0033';
    enemies.forEach(e => {
        if (e.state === 'dead') return;
        const dx = (e.mesh.position.x - player.x) * mapScale;
        const dy = (e.mesh.position.z - player.z) * mapScale;
        if (Math.abs(dx) < 70 && Math.abs(dy) < 70) {
            minimapCtx.fillRect(centerX + dx - 2, centerY + dy - 2, 4, 4);
        }
    });

    // Player (Neon Green pointer)
    minimapCtx.fillStyle = '#00ffcc';
    minimapCtx.beginPath();
    minimapCtx.arc(centerX, centerY, 4, 0, Math.PI*2);
    minimapCtx.fill();

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(yawObject.quaternion);
    minimapCtx.strokeStyle = '#00ffcc';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(centerX, centerY);
    minimapCtx.lineTo(centerX + dir.x * 12, centerY + dir.z * 12);
    minimapCtx.stroke();
}

// --- INITIALIZATION ---
function init() {
    sceneTextures = buildTextures();
    pickupTextures = buildPickupTextures();
    enemyTextures = buildEnemyTextures();
    weaponImages = buildWeaponHUDCanvasses();

    drawHUDFace(player.health);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0202);
    scene.fog = new THREE.FogExp2(0x0e0202, 0.015);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(600, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: sceneTextures.sky_hell, side: THREE.BackSide, fog: false });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);

    // Soft lights
    const ambient = new THREE.AmbientLight(0x2d1a3a); // Cosmic purple ambient
    scene.add(ambient);

    // Camera & Controls Object
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    pitchObject = new THREE.Object3D();
    pitchObject.add(camera);
    yawObject = new THREE.Object3D();
    yawObject.position.set(player.x, 8, player.z);
    yawObject.add(pitchObject);
    scene.add(yawObject);

    // Player local glowing light
    playerLight = new THREE.PointLight(0xffaaff, 1.2, 70);
    playerLight.position.set(0, 4, 0);
    yawObject.add(playerLight);

    // Renderer: Enable high pixel ratio and antialiasing
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Load Level 1 initially
    loadLevel(1);

    updateWeaponUI();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);

    document.getElementById('start-btn').addEventListener('click', () => {
        document.body.requestPointerLock();
        soundManager.init();
    });

    document.addEventListener('pointerlockchange', () => {
        isLocked = document.pointerLockElement === document.body;
        const menu = document.getElementById('start-screen');
        if (isLocked) {
            menu.classList.add('hidden');
        } else {
            if(!isDead && !isWin) {
                menu.classList.remove('hidden');
                document.getElementById('menu-title').innerText = "PAUSED";
                document.getElementById('start-btn').innerText = "RESUME";
            }
        }
    });

    // Custom Enemy Face Upload logic
    document.getElementById('custom-enemy-input').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.src = event.target.result;
            img.onload = function() {
                const customTex = new THREE.Texture(img);
                customTex.magFilter = THREE.NearestFilter;
                customTex.needsUpdate = true;
                // Swap soldier walk frames to this custom texture
                enemyTextures.soldier_walk1 = customTex;
                enemyTextures.soldier_walk2 = customTex;
                enemyTextures.soldier_attack = customTex;
                enemies.forEach(en => {
                    if (en.type === 'soldier') {
                        en.mesh.material.map = customTex;
                        en.mesh.material.needsUpdate = true;
                    }
                });
                alert("Custom Face uploaded as Soldier Demon!");
            }
        };
        reader.readAsDataURL(file);
    });
}

// --- GAME ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1); 

    if (isLocked && !isDead && !isWin) {
        updatePlayerMovement(delta);
        updateEnemies(delta, time);
        updateProjectiles(delta);
        updateDoors(delta);
        updateParticles(delta);
        updatePickups();

        faceTimer -= delta;
        if (faceTimer <= 0) {
            faceTimer = Math.random() * 1.5 + 1.0;
            const r = Math.random();
            if (r < 0.2) currentFaceExpr = 'look_left';
            else if (r < 0.4) currentFaceExpr = 'look_right';
            else currentFaceExpr = 'idle';
        }
        drawHUDFace(player.health, currentFaceExpr);

        // Firing Recoil Decay - decoupled from mouse pitch controls
        recoilPitch = Math.max(0, recoilPitch - 0.7 * delta);
        camera.rotation.x = recoilPitch; // Applied directly to camera inside pitchObject

        // Weapon bobbing animation
        if (moveForward || moveBackward || moveLeft || moveRight) {
            const bobX = Math.sin(time * 0.010) * 6;
            const bobY = Math.abs(Math.cos(time * 0.010)) * 4;
            document.getElementById('weapon-img').style.transform = `translate(${bobX}px, ${bobY}px)`;
        } else {
            document.getElementById('weapon-img').style.transform = `translate(0px, 0px)`;
        }

        updateWeaponUI();
        renderer.render(scene, camera);
        updateMinimap();
    }
    prevTime = time;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start the game!
init();
animate();