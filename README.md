Browser Doom - Custom Edition

A high-performance, retro-style 3D First Person Shooter (FPS) built with Three.js. This game features infinite procedural world generation, a classic pixel-art aesthetic, and the ability to upload your own images to create custom enemies.

🚀 Key Features

Infinite Procedural Generation: The world expands endlessly as you move. New "chunks" of hell are generated in real-time.

Custom Enemy Faces: A unique feature allowing players to upload any image file (PNG/JPG) to replace the demon's texture.

Retro Aesthetics: Pixelated textures and HUD designed to mimic the 1993 classic.

Dynamic Skybox: A hellish red gradient sky that follows the player throughout the infinite map.

Zero External Assets: All textures (walls, floors, guns) are generated dynamically using JavaScript Canvas, making the project lightweight and fast.

📂 Project Structure

To run the game in VS Code, ensure your folder looks like this:

/BrowserDoom
├── index.html      # The game structure and UI
├── style.css       # Retro fonts and HUD styling
├── script.js       # The 3D engine and game logic
└── README.md       # (This file)


⚙️ Setup Instructions

Download/Copy the three code files (index.html, style.css, script.js) into a single folder.

Open in VS Code.

Run with Live Server:

Install the "Live Server" extension in VS Code.

Right-click index.html and select "Open with Live Server".

Note: Using a server is required for the "Custom Face" upload feature to work correctly due to browser security settings.

🎮 How to Play

Controls

W / A / S / D: Move through the arena.

Mouse: Look around (Aim).

Left Click: Shoot your pistol.

ESC: Pause the game and release the mouse cursor.

Adding Custom Enemies

On the Start Screen, find the "Upload Custom Enemy Face" section.

Click "Choose File" and select any image from your computer.

Click "ENTER HELL".

Every demon in the infinite world will now feature your uploaded image!

🛠️ Technical Stack

Engine: Three.js (WebGL)

Language: JavaScript (ES6+)

Styling: CSS3 with Google Fonts (Press Start 2P)

API: HTML5 FileReader API for custom image uploads.

Created for personal and educational use. Happy hunting!
