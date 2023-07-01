---
layout: post
title: "Useful archlinux commands"
date: 2022-02-27 8:43:36 +0545
categories: linux unix
---

## To install package from AUR

```bash
# Properly install package from AUR with SNAPSHOT

cd /tmp && git clone 'https://aur.archlinux.org/yay.git' && cd /tmp/yay && makepkg -si && cd ~ && rm -rf /tmp/yay/
```

Reference: 
- [AUR](https://aur.archlinux.org/)
