---
layout: post
title: "Reading manual pages"
date: 2022-02-14 10:45:36 +0545
categories: linux unix
---

Man - refered to manual page

By default, man typically uses a terminal pager program such as more or less to display its output.

### Man Page gudelines
```
#SYNOPSIS

bold text          type exactly as shown.
italic text        replace with appropriate argument.
[-abc]             any or all arguments within [ ] are optional.
-a|-b              options delimited by | cannot be used together.
argument ...       argument is repeatable.
[expression] ...   entire expression within [ ] is repeatable.
```


### Some useful commands
```
q/Q - quit manual page
j - Forward  one line   (or N lines).
k - Backward one line   (or N lines).
^F - Forward  one window (or N lines).
^B - Backward one window (or N lines).
```

### Reference
- [Man Page wiki](https://en.wikipedia.org/wiki/Man_page)
- [Mastering Linux Man Pages - A Definitive Guide](https://www.youtube.com/watch?v=RzAkjX_9B7E)
