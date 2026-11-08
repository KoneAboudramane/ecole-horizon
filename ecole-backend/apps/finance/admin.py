from django.contrib import admin

from . import models

for m in (models.Tarif, models.FeeDate, models.Payment, models.StatementLine, models.PaymentIntent):
    admin.site.register(m)
