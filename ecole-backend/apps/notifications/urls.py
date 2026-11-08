from django.urls import path

from . import views

urlpatterns = [
    path("notifications/", views.NotificationList.as_view()),
    path("notifications/unread-count/", views.UnreadCount.as_view()),
    path("notifications/read/", views.MarkRead.as_view()),
    path("notifications/push/", views.PushConfig.as_view()),
    path("notifications/push/subscribe/", views.PushSubscribe.as_view()),
    path("notifications/push/unsubscribe/", views.PushUnsubscribe.as_view()),
]
