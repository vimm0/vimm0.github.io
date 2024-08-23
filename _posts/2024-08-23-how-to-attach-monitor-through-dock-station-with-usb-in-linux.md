---
layout: post
title:  "How to attach monitor through dock station with usb in Arch linux"
date:   2024-08-23 00:18:23 +0700
categories: linux
---

**DisplayLink** is a technology that allows you to connect additional monitors to your computer through USB. It typically uses a DisplayLink chipset embedded in docking stations or adapters. On Linux, including Arch Linux, using DisplayLink requires specific drivers to function correctly, as native support for USB-based video output isn't always included in the Linux kernel.

### Steps to Attach Two Monitors Through Dell Dock Station with USB Output on Laptop

To use DisplayLink on Arch Linux with your laptop and a Dell docking station, you'll need to follow these general steps:

#### 1. **Install Required Packages**
   
   Arch Linux doesn't include DisplayLink drivers by default, so you'll need to install them.

   1. **Install `evdi` (Extended Virtual Display Interface):**
      - The `evdi` kernel module is a requirement for DisplayLink to work on Linux. It provides a virtual display interface that the DisplayLink driver uses.
      
      ```bash
      sudo pacman -Syu
      git clone https://aur.archlinux.org/evdi.git
      cd evdi
      makepkg -si
      ```

   2. **Install DisplayLink Driver:**
      - You can install the DisplayLink driver from the AUR. This driver enables the use of DisplayLink technology on Linux.

      ```bash
      git clone https://aur.archlinux.org/displaylink.git
      cd displaylink
      makepkg -si
      ```

   3. **Install `xf86-video-intel` (if using Intel graphics):**
      - If your laptop uses Intel graphics, ensure you have the Intel graphics driver installed. This driver is often necessary for proper operation of the DisplayLink setup.

      ```bash
      sudo pacman -S xf86-video-intel
      ```

#### 2. **Load the DisplayLink Driver**

   After installing the driver, you'll need to load the DisplayLink module and start the associated service.

   ```bash
   sudo modprobe evdi
   sudo systemctl start displaylink.service
   sudo systemctl enable displaylink.service
   ```

   You can verify that the service is running by using:

   ```bash
   systemctl status displaylink.service
   ```

#### 3. **Connect the Dell Dock Station**

   - Connect the Dell dock station to your laptop via USB.
   - Plug in the monitors into the dock station.

#### 4. **Configure Monitors**

   Once everything is connected and the drivers are running, you may need to configure your monitors:

   1. **Use `xrandr`:**
      - `xrandr` is a command-line tool to manage and configure display settings.
      - Check connected displays:

        ```bash
        xrandr --listmonitors
        ```

      - Arrange or set the resolution of your monitors:

        ```bash
        xrandr --output <DisplayPort-Name> --auto --left-of <Other-Monitor-Name>
        ```

      Replace `<DisplayPort-Name>` and `<Other-Monitor-Name>` with the actual output names listed by `xrandr`.

   2. **Use a GUI Tool:**
      - Alternatively, you can use a graphical tool like `arandr`, which provides a graphical interface to `xrandr`.

      ```bash
      sudo pacman -S arandr
      ```

      - Launch `arandr` and configure your monitors through the interface.

#### 5. **Troubleshooting**

   - **Check Logs:** If something isn't working, check the logs for errors:

     ```bash
     journalctl -xe | grep displaylink
     ```

   - **Black Screen:** If you experience a black screen or no display on one monitor, try switching USB ports or updating your system.

   - **Driver Issues:** If updates cause problems, you may need to rebuild the `evdi` and `displaylink` packages from AUR.

   - **Flickering Issues**: Screen flickering with DisplayLink setups on Linux can be a common issue, especially when using USB-based video output. This can be caused by several factors including driver issues, insufficient power, or configuration settings.

      - **Turn off USB Autosuspend:** Power-saving features can cause issues with USB devices like docking stations. You can try disabling USB autosuspend:
         1. Edit the kernel parameters:
            ```bash
            sudo nano /etc/default/grub
            ```
         2. Add `usbcore.autosuspend=-1` to the `GRUB_CMDLINE_LINUX_DEFAULT` line. For example:
            ```
            GRUB_CMDLINE_LINUX_DEFAULT="quiet splash usbcore.autosuspend=-1"
            ```
         3. Update GRUB:
            ```bash
            sudo grub-mkconfig -o /boot/grub/grub.cfg
            ```
         4. Reboot your system:
            ```bash
            sudo reboot
            ```
### Conclusion

Following these steps should allow you to set up and configure two monitors connected through a Dell docking station on  Arch Linux. Remember that DisplayLink on Linux might require some manual configuration, and performance could be lower than with native HDMI/DisplayPort connections due to the USB interface's bandwidth limitations.
