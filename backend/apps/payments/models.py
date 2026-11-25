from django.conf import settings
from django.db import models


class Payment(models.Model):
    METHODS = [("mpesa", "M-Pesa"), ("card", "Card"), ("cash", "Cash"), ("bank", "Bank transfer")]
    STATUS = [
        ("pending", "Pending"),
        ("success", "Paid"),
        ("failed", "Failed"),
        ("expired", "Expired"),
        ("cancelled", "Cancelled"),
        ("refunded", "Refunded"),
    ]
    PURPOSES = [("full", "Full payment"), ("deposit", "Deposit"), ("balance", "Balance"), ("addon", "Add-on")]

    booking = models.ForeignKey("bookings.Booking", on_delete=models.CASCADE, related_name="payments")
    amount = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="KES")
    method = models.CharField(max_length=6, choices=METHODS)
    purpose = models.CharField(max_length=8, choices=PURPOSES, default="full")
    status = models.CharField(max_length=10, choices=STATUS, default="pending", db_index=True)
    phone = models.CharField(max_length=20, blank=True)
    provider = models.CharField(max_length=20, default="simulate")
    transaction_id = models.CharField(max_length=80, null=True, blank=True, unique=True)
    provider_ref = models.CharField(max_length=80, blank=True, help_text="M-Pesa receipt, card auth code…")
    checkout_token = models.CharField(max_length=64, null=True, blank=True, unique=True)
    failure_reason = models.CharField(max_length=200, blank=True)
    raw = models.JSONField(default=list, blank=True, help_text="Provider responses and callbacks, for reconciliation")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return f"{self.booking_id} {self.method} {self.amount} {self.status}"


class Refund(models.Model):
    METHODS = [("mpesa_b2c", "M-Pesa (B2C)"), ("card", "Card reversal"), ("manual", "Manual / cash")]
    STATUS = [("pending", "Pending"), ("success", "Sent"), ("failed", "Failed")]
    booking = models.ForeignKey("bookings.Booking", on_delete=models.CASCADE, related_name="refunds")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="refunds")
    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=10, choices=METHODS, default="mpesa_b2c")
    status = models.CharField(max_length=8, choices=STATUS, default="pending")
    provider_ref = models.CharField(max_length=80, blank=True)
    reason = models.CharField(max_length=200, blank=True)
    raw = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
