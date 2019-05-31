---
layout: post
title:  "Google Webp Conversion In Archlinux"
date:   2019-01-01 10:20:36 +0545
categories: google
---
- Download package from AUR(archlinux):
    - [https://www.archlinux.org/packages/extra/x86_64/libwebp/](https://www.archlinux.org/packages/extra/x86_64/libwebp/)
    - Type in `yarout -S libwebp`
- Command to convert webp to png:


{% highlight ruby %}
$ cwebp -q 80 image.png -o image.webp
{% endhighlight %}

- Command to convert png to webp:

{% highlight ruby %}
$ dwebp image.webp -o image.png
{% endhighlight %}

_Original source:_ [_https://developers.google.com/speed/webp/_](https://developers.google.com/speed/webp/)

