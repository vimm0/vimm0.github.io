---
layout: post
title: "Graphql-voyager on graphene-django"
date: 2021-10-14 01:02:36 +0545
categories: django
---
## Introduction
If you want to `graphql-voyager` on `graphene_django`, you should override template in `graphene_django/templates/graphene/graphiql.html`.

{% gist c11ff90b83429e45a91b7b97c50ba6e6 %}

## Sources from Graphene Django Issues:

 - [Add GraphiQL Explorer #1204](https://github.com/graphql-python/graphene-django/issues/1204)
 - [How can I integrate with GraphiQL explorer and GraphQL Voyager?  #834](https://github.com/graphql-python/graphene-django/issues/834)
 - [Graphql Voyager Full Source](https://github.com/APIs-guru/graphql-voyager/blob/master/example/index.html)
