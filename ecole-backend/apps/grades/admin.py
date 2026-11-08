from django.contrib import admin

from . import models

for m in (models.Evaluation, models.Grade, models.Appreciation, models.CouncilComment, models.Decision):
    admin.site.register(m)
