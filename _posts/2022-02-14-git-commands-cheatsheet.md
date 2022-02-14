---
layout: post
title: "Git Commands Cheatsheet"
date: 2022-02-14 10:45:36 +0545
categories: git
---

#### Git Command Cheatsheet

```
# When starting work on a new feature, branch off from the develop branch.
git checkout -b myfeature develop

# Finished features may be merged into the develop branch to definitely add them to the upcoming release:

git checkout develop
git merge --no-ff myfeature
git branch -d myfeature
git push origin develop

```