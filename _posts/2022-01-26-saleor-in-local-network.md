---
layout: post
title: "Run saleor dashboard in local network"
date: 2022-01-26 06:00:36 +0545
categories: django
---

- `<ip-address>` should be your ip address and is exclusive of http protocol (http:// or https://).

```
settings.py [in dev mode.]

....
DEBUG = True
ALLOWED_HOSTS = ['<ip-address>']
....
```

- runserver django server with `./manage.py runserver <ip-address>:8000`
- edit your `webpack.config.js` file 
```
webpack.config.js [in dev mode.]

....
host: '<ip-address>',
disableHostCheck: true,
....
```
- edit your `src/config.ts` file 

```
src/config.ts [in dev mode.]

....
export const API_URI = "http://<ip-address>/graphql/";
....
```
- runserver dashboard server as usual.
