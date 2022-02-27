---
layout: post
title: "Clean your archlinux"
date: 2022-02-27 8:28:36 +0545
categories: linux, unix
---

You can clean your archlinux, with some suitable packages so that your system remain clean.
> :warning: **Be aware your system might not work properly if not followed properly, so backup first.** Be very careful here!


### Some useful commands
```
1. Clean package cache
sudo pacman -U /var/cache/pacman/pkg/packagename
    - Cleaning the cache manually
        sudo pacman -Sc or sudo pacman -Scc
    - Cleaning the cache Automatically
        sudo pacman -S pacman-contrib
        paccache -h
        paccache -d && paccache -r 

2. Remove unused packages (orphans)
sudo pacman -Qtdq # shows list of all unused packages
sudo pacman -Rns $(pacman -Qtdq) # removes all the unused pacakges

3. Clean the cache in your /home directory
sudo du -sh ~/.cache/
rm -rf ~/.cache/*

```

### Reference
- [How to clean Arch Linux](https://averagelinuxuser.com/clean-arch-linux/#1-clean-package-cache)
