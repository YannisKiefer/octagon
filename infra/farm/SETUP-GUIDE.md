# SETUP GUIDE: Octragon Stealth Phone Farm

This guide will walk you through setting up your iPhones for the undetectable Voice Control automation.

## 1. iPhone Configuration (Accessibility)
Perform these steps on each iPhone you want to automate:

1. **Enable Voice Control:**
   - Go to **Settings > Accessibility > Voice Control**.
   - Toggle **Voice Control** to **ON**.
   - Set the language to **English (United States)**.

2. **Create Custom Gestures:**
   - Go to **Commands > Custom > Create New Command...**.
   - Create the following commands exactly:
     - **"Swipe Next"**: Action -> Run Custom Gesture -> Record a quick swipe up from bottom to top.
     - **"Like Post"**: Action -> Run Custom Gesture -> Record a quick double-tap in the center of the screen.
     - **"Save Post"**: Action -> Run Custom Gesture -> Record a single tap on the 'Bookmark' icon location (bottom right).
     - **"Open Profile"**: Action -> Run Custom Gesture -> Record a single tap on the profile picture/handle location.
   - Save each command.

3. **Disable "Confirm Before Performing":**
   - In the Voice Control settings, ensure "Confirm Before Performing" is **OFF** to avoid popups.

## 2. Hardware Setup
- Connect your iPhones to your Mac via USB cables.
- The item you asked for is a **Powered USB Hub** (preferably USB 3.0 or USB-C). This allows you to plug 1 cable into your Mac and connect up to 7-10 phones.

## 3. Running the Automation
1. **Navigate to the farm directory:**
   ```bash
   cd ~/clawd/brain/octragon-system/farm
   ```
2. **Install dependencies:**
   ```bash
   npm install chalk ora cli-table3 better-sqlite3
   ```
3. **Start the Brain:**
   ```bash
   node farm-brain.js --duration=60
   ```
   *Note: Ensure your Mac's sound is audible or connected to the phones so they can "hear" the commands.*

## 4. Monitoring
- Open the Octragon Dashboard: **http://localhost:3030/farm**
- You will see the real-time swipes and engagement metrics as the bot runs.
