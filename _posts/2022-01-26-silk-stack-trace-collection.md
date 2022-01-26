---
layout: post
title: "Silk stack trace collection"
date: 2022-01-26 06:00:36 +0545
categories: django
---
- You might run into condition where default stack trace collection might not be enough from `django-silk`, then you might need to tweak silk package.
- install [django-silk](https://github.com/jazzband/django-silk#installation), [ipdb](https://github.com/gotcha/ipdb#use)

```
Cprofile in Silk
================
file :"collector.py"
Class DataCollector
.....
def finalise(self):
    if getattr(self.local, 'pythonprofiler', None):
        s = StringIO()
        import os
        from pstats import SortKey
        from django.conf import settings
        sortby = SortKey.TIME
        ps = pstats.Stats(self.local.pythonprofiler, stream=s).sort_stats(sortby)
        ps.print_stats()
        profile_text = s.getvalue()
        # import ipdb
        # ipdb.set_trace()
        print(profile_text)

        # write to file
        with open(f"{os.path.dirname(settings.BASE_DIR)}/<path-where-you-want-collection>/sample.txt", 'w+') as dump_file:
            dump_file.write(profile_text)
            # dump_file.close()
.....
```
- collection of stack trace would help to debug django.
