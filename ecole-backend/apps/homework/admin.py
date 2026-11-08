from django.contrib import admin

from .models import Assignment, Question, Submission

admin.site.register(Assignment)
admin.site.register(Question)
admin.site.register(Submission)
