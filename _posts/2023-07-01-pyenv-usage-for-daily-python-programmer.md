---
layout: post
title: "Practical usage of pyenv for daily python programmer"
date: 2023-07-01 7:00:36 +0545
categories: python
---

## Introduction

As a Python programmer, managing different Python versions and dependencies can be a challenging task. However, there's a handy tool called `pyenv` that can greatly simplify this process. In this blog post, we will explore the practical usage of `pyenv` and how it can benefit you in your daily Python development workflow.

## What is pyenv?

`pyenv` is a lightweight Python version management tool that allows you to easily switch between multiple Python versions on your machine. It provides a simple command-line interface to manage and install different Python interpreters. Whether you need to work with Python 2 or Python 3, or even specific versions within each branch, `pyenv` makes it effortless.

## Installation

To get started with `pyenv`, you first need to install it on your machine. The installation process depends on your operating system, but the official [`pyenv` github repository](https://github.com/pyenv/pyenv) provides clear instructions for various platforms.

Once `pyenv` is successfully installed, you can start leveraging its power for your Python development tasks.

## Managing Python Versions

One of the main advantages of `pyenv` is its ability to manage multiple Python versions side by side. Instead of relying solely on the system's default Python interpreter, you can effortlessly switch between different versions based on your project requirements.

## Installing Python Versions

`pyenv` makes installing Python versions a breeze. You can use the `pyenv install` command followed by the desired version to automatically download and install it. For example, to install Python 3.9.6, you would run:

```
$ pyenv install 3.9.6
```

This will fetch the specified version from the official Python website and install it locally.

## Switching Python Versions

Once you have multiple Python versions installed, you can switch between them using the `pyenv global`, `pyenv local`, or `pyenv shell` commands.

- `pyenv global` sets the Python version globally, which means it will be the default version used for all projects.
- `pyenv local` sets the Python version for the current directory and its child directories. This allows you to have different versions for different projects.
- `pyenv shell` sets the Python version for the current shell session, overriding the global and local settings temporarily.

To set Python 3.9.6 as the global version, you would execute:

```
$ pyenv global 3.9.6
```

Now, whenever you run `python` or `python3`, it will point to the specified version.

## Virtual Environments with pyenv

In addition to managing Python versions, `pyenv` can also create virtual environments using the `pyenv virtualenv` command. Virtual environments allow you to isolate project dependencies and avoid conflicts between different projects.

To create a virtual environment named "myenv" with Python 3.9.6, you would run:

```
$ pyenv virtualenv 3.9.6 myenv
```

This will create a new virtual environment using the specified Python version.

To activate the virtual environment, you can use the `pyenv activate` command:

```bash
$ pyenv activate myenv
```

From now on, any Python command executed in the current shell session will use the virtual environment, ensuring that the project's dependencies are isolated.

## Auto-activating environments
There is nothing more frustrating than realising that you had not activated the correct virtual environment just after installing extra libraries. This will surely overwrite the older versions of the packages installed in the currently activated environment and may break your project code. The distinct advantage of pyenv is that it can automatically activate the correct environment for each project.

```
$ pyenv local myenv
```

## Managing Dependencies

`pyenv` also integrates well with popular Python dependency management tools like `pip` and `pipenv`. With `pyenv` and these tools combined, you can effortlessly manage project-specific dependencies without affecting other projects or the global Python environment.

By utilizing virtual environments as mentioned earlier, you can create an isolated environment for each project and manage

 its dependencies separately. This approach promotes reproducibility and avoids conflicts between different projects.

## Commands

| Command                               | Description                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pyenv install <version>`             | Install a specific Python version.                                                               |
| `pyenv versions`                      | List all installed Python versions.                                                              |
| `pyenv global <version>`              | Set the global Python version to be used in the system.                                          |
| `pyenv local <version>`               | Set the Python version for the current directory or project.                                     |
| `pyenv shell <version>`               | Set the Python version for the current shell session.                                            |
| `pyenv virtualenv <version> <env_name>` | Create a new virtual environment using a specific Python version.                                |
| `pyenv activate <env_name>`           | Activate a specific virtual environment.                                                         |
| `pyenv deactivate`                    | Deactivate the currently active virtual environment.                                             |
| `pyenv uninstall <version>`           | Uninstall a specific Python version.                                                             |
| `pyenv rehash`                        | Rehash the shims after installing new Python executables or packages.                            |
| `pyenv which <command>`               | Show the full path to the executable of a specific command.                                      |


## Conclusion

`pyenv` is a powerful tool that simplifies Python version management and dependency isolation for Python programmers. By effortlessly switching between different Python versions and creating virtual environments, you can work on diverse projects without worrying about compatibility issues or dependency conflicts.

Whether you're a beginner or an experienced Python developer, `pyenv` is definitely worth exploring. Its straightforward installation process, intuitive commands, and seamless integration with other Python tools make it a valuable addition to your daily Python programming toolbox. Give it a try and experience the convenience and flexibility it offers in your Python development workflow!