from django.contrib import admin

from . import models

for m in (models.Announcement, models.Thread, models.Message):
    admin.site.register(m)
