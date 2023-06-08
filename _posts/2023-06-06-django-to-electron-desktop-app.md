---
layout: post
title: "Django to electron desktop application"
date: 2023-06-06 1:58:36 +0545
categories: linux django electron
---

{:refdef: style="text-align: center;"}
![2023-06-06-django-to-electron-desktop-app-1](/images/2023-06-06-django-to-electron-desktop-app-1.png){: width="50%" height="80%" }
{: refdef}

Django application is python-based web framework that follows the model–template–views architectural pattern. This contain server which respond to client's request but django application need to start application from command prompt which need some technical knowledge. 

Some clients may find scary to write command in command prompt. So to reduce the friction between application and user, we created an application in electron so that end-user could open their application in one-click. 

# For Linux User
I have released version `1.0.0` of the [project](https://github.com/vimm0/web-desktop), and users can download it from the release page.

To run the downloaded release, please follow these steps:

1. Download the release package from [webdesk-1.0.0](https://github.com/vimm0/web-desktop/releases/tag/webdesk-1.0.0) to a local directory on your computer.
2. Unpack the downloaded file. The specific steps may vary depending on your operating system.
3. Once unpacked, navigate to the `Webdesk-linux-x64` directory.
4. Open a terminal or command prompt in that directory.
5. Run the following command to start the Web Desktop application:
   ```
   $ ./Webdesk
   ```

This command will launch the Web Desktop application using the provided executable file.

If you encounter any issues or need further assistance, please let me know. Also everyone is welcome to star and involve in project.

Reference: [https://github.com/vimm0/web-desktop](https://github.com/vimm0/web-desktop)