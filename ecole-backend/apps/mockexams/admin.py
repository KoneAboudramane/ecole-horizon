from django.contrib import admin

from . import models

admin.site.register(models.MockSession)
admin.site.register(models.MockMark)
