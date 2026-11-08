from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.academics.urls")),
    path("api/v1/", include("apps.students.urls")),
    path("api/v1/", include("apps.grades.urls")),
    path("api/v1/", include("apps.notifications.urls")),
    path("api/v1/", include("apps.attendance.urls")),
    path("api/v1/", include("apps.discipline.urls")),
    path("api/v1/", include("apps.finance.urls")),
    path("api/v1/", include("apps.communication.urls")),
    path("api/v1/", include("apps.schedule.urls")),
    path("api/v1/", include("apps.mockexams.urls")),
    path("api/v1/", include("apps.homework.urls")),
]
if settings.DEBUG:
    # Schéma et documentation interactive : développement seulement
    urlpatterns += [path("api/schema/", SpectacularAPIView.as_view(), name="schema"), path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs")]
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
