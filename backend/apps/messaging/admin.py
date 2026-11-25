from django.contrib import admin

from .models import Thread, Message, Template, Automation, FAQ, Broadcast, Conversation

admin.site.register(Thread)
admin.site.register(Message)
admin.site.register(Template)
admin.site.register(Automation)
admin.site.register(FAQ)
admin.site.register(Broadcast)
admin.site.register(Conversation)
