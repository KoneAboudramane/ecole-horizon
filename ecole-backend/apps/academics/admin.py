from django.contrib import admin

from . import models

for m in (models.SchoolYear, models.Term, models.Subject, models.SchoolClass, models.Coefficient, models.Teacher,
          models.TeachingAssignment):
    admin.site.register(m)
