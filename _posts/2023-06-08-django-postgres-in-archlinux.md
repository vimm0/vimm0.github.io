---
layout: post
title: "Setup Django and postgres in archlinux"
date: 2023-06-08 8:58:36 +0545
categories: linux django postgres
---

<!-- Sure! Here's a markdown gist that outlines the steps to set up Django and PostgreSQL in Arch Linux: -->

This guide will walk you through the process of setting up Django, a popular Python web framework, and PostgreSQL, a powerful open-source relational database management system, on Arch Linux.

### 1. Install required packages

Open your terminal and run the following commands to install the necessary packages:

```shell
sudo pacman -Sy python python-pip python-virtualenv postgresql
```

### 2. Initialize and activate a virtual environment

Navigate to your project directory and create a virtual environment using `virtualenv`:

```shell
cd /path/to/your/project
virtualenv env
```

Activate the virtual environment:

```shell
source env/bin/activate
```

### 3. Install Django

Install Django within the virtual environment using pip:

```shell
pip install django
```

### 4. Configure PostgreSQL

#### Install PostgreSQL

Install PostgreSQL using pacman:

```shell
sudo pacman -Sy postgresql
```

#### Initialize the database cluster


```shell
sudo -u postgres initdb --locale en_US.UTF-8 -E UTF8 -D '/var/lib/postgres/data'
```

#### Start and enable the PostgreSQL service


```shell
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Create a PostgreSQL user and database

Access the PostgreSQL prompt:

```shell
sudo -u postgres psql
```

Create a new database:

```shell
CREATE DATABASE your_database_name;
```

Create a new user and grant it privileges on the database:

```shell
CREATE USER your_username WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE your_database_name TO your_username;
```

Exit the PostgreSQL prompt:

```shell
\q
```

### 5. Configure Django settings

Open your Django project's settings file (`settings.py`) and update the following settings:

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'your_database_name',
        'USER': 'your_username',
        'PASSWORD': 'your_password',
        'HOST': 'localhost',
        'PORT': '',
    }
}
```

### 6. Run database migrations

Now you can run the initial database migrations:

```shell
python manage.py migrate
```

### 7. Start the Django development server

You're all set! Start the Django development server and access your application in your web browser:

```shell
python manage.py runserver
```

That's it! You have successfully set up Django and PostgreSQL in Arch Linux.


Please note that this guide assumes you have basic knowledge of working with the terminal and the Arch Linux package manager, `pacman`. Adjust the instructions as necessary based on your specific project requirements and preferences.