from django.contrib import admin

from .models import AccessCode, Addon, Booking, BookingAddon, BookingEvent, BookingGuest, Waitlist

admin.site.register(Booking)
admin.site.register(BookingGuest)
admin.site.register(BookingEvent)
admin.site.register(Addon)
admin.site.register(BookingAddon)
admin.site.register(AccessCode)
admin.site.register(Waitlist)
