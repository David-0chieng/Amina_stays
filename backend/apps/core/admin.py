from django.contrib import admin

from .models import SiteSettings, Activity, OnceMarker, JobRun

admin.site.register(SiteSettings)
admin.site.register(Activity)
admin.site.register(OnceMarker)
admin.site.register(JobRun)
