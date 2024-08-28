---
layout: post
title:  "How to run flutter with vscode in Arch linux"
date:   2024-08-26 00:18:23 +0000
categories: linux
---

To run a Flutter app from VSCode on different devices (Android Emulator, Physical Android Device, Physical iOS Device) with a Django backend on Linux, follow these steps:

### 1. **Run Django Backend**
   - **Start Django Server:**
     - Navigate to your Django project directory in the terminal.
     - Run the Django development server:
       ```bash
       python manage.py runserver
       ```
     - By default, Django runs on `http://127.0.0.1:8000/`. You can specify a different port by running:
       ```bash
       python manage.py runserver 0.0.0.0:<port_number>
       ```
     - For example, to run on port `8001`, use:
       ```bash
       python manage.py runserver 0.0.0.0:8001
       ```
     - **Note the port** where your Django server is running.

### 2. **Configure Flutter App**
   - **API Base URL in Flutter:**
     - Update your Flutter app’s API base URL in the code (usually in `lib/constants.dart` or a similar file) to point to your Django backend:
       ```dart
       const String baseUrl = 'http://127.0.0.1:8000'; // Or the specific port you chose
       ```
     - If you’re using an Android emulator or a physical device, change the URL to the appropriate IP address:
       - **Android Emulator:** Use `http://10.0.2.2:<port>` (Emulator's loopback address to localhost).
       - **Physical Android/iOS Device:** Replace `127.0.0.1` with your machine's IP address.

### 3. **Running on Devices**
  - ##### A. **Android Emulator**
    - **Start the Emulator:**
      - Open the VSCode terminal and start the Android emulator using AVD Manager or command:
        ```bash
        emulator -avd <emulator_name>
        ```
      - Alternatively, you can start it from VSCode by clicking the device selector on the bottom status bar.
    - **Run the Flutter App:**
      - In VSCode, open the Flutter project.
      - Press `F5` or use the "Run" menu and select "Start Debugging" to launch the app in the emulator.

  - ##### B. **Physical Android Device**
    - **Enable Developer Mode and USB Debugging:**
      - On your Android phone, enable Developer Options and USB Debugging.
    - **Connect the Device:**
      - Connect the phone to your Linux machine via USB.
    - **Run the Flutter App:**
      - In VSCode, select your device from the device selector at the bottom.
      - Press `F5` or start debugging.

  - ##### C. **Physical iOS Device**
    - **Connect the iPhone:**
      - Connect your iPhone to your Linux machine via USB.
    - **Start the App:**
      - Ensure that your iPhone is trusted and developer mode is enabled.
      - In VSCode, select your iPhone from the device list.
      - Press `F5` to run the app.
      - Note: On Linux, you may need a Mac for building and deploying to an iOS device due to Xcode requirements.

### 4. **Port Details**
   - **Django Backend:** Default is `8000`, but can be changed to any port.
   - **Flutter App:**
     - **Android Emulator:** `http://10.0.2.2:<port>`
     - **Physical Android/iOS Device:** `http://<your_machine_ip>:<port>`

### 5. **Accessing the Backend in Flutter**
   - **Ensure that the device can reach the Django server:**
     - If using a physical device, your machine's IP address should be accessible from the device.
     - If using an emulator, use the special IP addresses mentioned above.

By following these steps, you can run your Flutter app on different devices with a Django backend on Linux. Make sure your backend server is accessible to the device or emulator.