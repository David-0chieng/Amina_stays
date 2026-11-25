"""HTTP API: phone login, permissions, staged disclosure of check-in details, and iCal sync."""

import pytest

from apps.bookings import services as bookings
from apps.payments import services as payments
from apps.payments.models import Payment
from apps.properties.models import CalendarBlock, ICalFeed
from apps.properties.services import export_ics, sync_feed

from .conftest import days


@pytest.mark.django_db
def test_otp_login_flow(api):
    r = api.post("/api/auth/otp/request", {"phone": "0712 345 678"}, format="json")
    assert r.status_code == 200 and r.data["phone"] == "+254712345678"
    assert api.post("/api/auth/otp/verify", {"phone": "+254712345678", "code": "000000"}, format="json").status_code == 400
    r = api.post("/api/auth/otp/verify", {"phone": "+254712345678", "code": r.data["debug_code"]}, format="json")
    assert r.status_code == 200 and r.data["authenticated"]
    assert api.get("/api/auth/me").data["phone"] == "+254712345678"


@pytest.mark.django_db
def test_otp_resend_gap_and_debug_code_only_in_demo(api, settings):
    assert api.post("/api/auth/otp/request", {"phone": "+254700555001"}, format="json").status_code == 200
    assert api.post("/api/auth/otp/request", {"phone": "+254700555001"}, format="json").status_code == 400  # 30 s gap
    settings.DEMO = False
    r = api.post("/api/auth/otp/request", {"phone": "+254700555002"}, format="json")
    assert r.status_code == 200 and "debug_code" not in r.data


@pytest.mark.django_db
def test_guests_cannot_see_each_others_trips(unit, guest, foreign_guest, api):
    b = bookings.create_hold(unit=unit, guest=foreign_guest, check_in=days(5), check_out=days(7), channel="web")
    api.force_authenticate(guest)
    assert api.get(f"/api/bookings/{b.ref}").status_code == 404
    api.force_authenticate(foreign_guest)
    assert api.get(f"/api/bookings/{b.ref}").status_code == 200


@pytest.mark.django_db
def test_host_console_is_for_hosts_only(api, guest_api, host_api):
    assert api.get("/api/host/today").status_code in (401, 403)
    assert guest_api.get("/api/host/reservations").status_code == 403
    assert host_api.get("/api/host/today").status_code == 200
    assert host_api.get("/api/host/reservations").status_code == 200


@pytest.mark.django_db
def test_demo_endpoints_disappear_without_demo_mode(api, settings):
    settings.DEMO = False
    assert api.post("/api/demo/reset").status_code == 404
    assert api.post("/api/demo/sms", {"from": "+254700000123", "text": "hi"}, format="json").status_code == 404


@pytest.mark.django_db
def test_check_in_details_are_disclosed_in_stages(unit, guest, guest_api):
    b = bookings.create_hold(unit=unit, guest=guest, check_in=days(20), check_out=days(22), channel="web")
    held = guest_api.get(f"/api/bookings/{b.ref}").data["checkin"]
    assert "address" not in held and "wifi_password" not in held
    payments.start_payment(b, method="mpesa")
    payments.on_success(Payment.objects.get(booking=b), transaction_id="QSTAGE")
    confirmed = guest_api.get(f"/api/bookings/{b.ref}").data["checkin"]
    assert confirmed["address"] == unit.address  # address once booked…
    assert "wifi_password" not in confirmed and "code" not in confirmed  # …Wi-Fi and directions only 48 h before


@pytest.mark.django_db
def test_web_booking_end_to_end(unit, guest, guest_api):
    r = guest_api.post("/api/bookings", {"listing": unit.slug, "check_in": days(9).isoformat(), "check_out": days(11).isoformat(),
                                         "adults": 2, "payment_method": "mpesa", "name": "Wanjiru Test"}, format="json")
    assert r.status_code == 201, r.data
    ref = r.data["booking"]["ref"]
    assert r.data["payment"]["method"] == "mpesa"
    payments.on_success(Payment.objects.get(booking__ref=ref), transaction_id="QWEB1")
    trip = guest_api.get(f"/api/bookings/{ref}").data
    assert trip["status"] == "confirmed" and trip["price"]["balance_due"] == 0
    clash = guest_api.post("/api/bookings", {"listing": unit.slug, "check_in": days(10).isoformat(), "check_out": days(12).isoformat()}, format="json")
    assert clash.status_code == 409


@pytest.mark.django_db
def test_ical_export_and_import(unit, other_unit, guest):
    b = bookings.create_hold(unit=unit, guest=guest, check_in=days(5), check_out=days(8), channel="web")
    payments.start_payment(b, method="mpesa")
    payments.on_success(Payment.objects.get(booking=b), transaction_id="QICS")
    ics = export_ics(unit)
    assert "BEGIN:VCALENDAR" in ics and f"DTSTART;VALUE=DATE:{days(5):%Y%m%d}" in ics

    feed = ICalFeed.objects.create(unit=other_unit, name="Airbnb", url="https://example.com/airbnb.ics")
    ci, co = days(14), days(17)
    text = (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Airbnb Inc//Hosting Calendar//EN\r\n"
        f"BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:{ci:%Y%m%d}\r\nDTEND;VALUE=DATE:{co:%Y%m%d}\r\nUID:abc-123@airbnb.com\r\n"
        "SUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    )
    sync_feed(feed, text=text)
    assert CalendarBlock.objects.filter(unit=other_unit, start_date=ci, end_date=co).exists()
    with pytest.raises(bookings.BookingError):
        bookings.create_hold(unit=other_unit, guest=guest, check_in=days(15), check_out=days(16), channel="web")
