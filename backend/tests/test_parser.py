try:
    import pytest
except ImportError:
    class _MockPytest:
        class mark:
            @staticmethod
            def parametrize(argnames, argvalues):
                def decorator(fn):
                    fn.pytestmark = True
                    return fn
                return decorator
        @staticmethod
        def fixture(fn):
            return fn
    pytest = _MockPytest()

from app.services.parser import parse_telegram_message, format_amount


def test_parse_standard_aba_payway():
    text = (
        "PayWay by ABA:\n"
        "៛100 paid by LY LAISRUN (*964)\n"
        "on Jul 04, 02:14 PM\n"
        "via ABA PAY\n"
        "at KIM PUTDARARITH.\n"
        "Trx. ID: 178314927151090\n"
        "APV: 444368"
    )
    result = parse_telegram_message(text)
    assert result is not None
    assert result["transaction_id"] == "178314927151090"
    assert result["customer_name"] == "LY LAISRUN"
    assert result["phone"] == "*964"
    assert result["amount"] == 100.0
    assert result["currency"] == "KHR"
    assert result["bank"] == "ABA"
    assert result["payment_method"] == "ABA PAY"
    assert result["merchant"] == "KIM PUTDARARITH"
    assert result["apv"] == "444368"


@pytest.mark.parametrize("name", [
    "PATRICK",
    "JONATHAN",
    "SIMON",
    "ANTON",
    "BEATRIX",
    "SOK CHEAT",
    "BOPHA TELECOM",
    "សុខ សាន",
])
def test_parse_customer_names_not_truncated(name):
    text = (
        "PayWay by ABA:\n"
        f"$25.50 paid by {name} (*123)\n"
        "on Jul 04, 02:14 PM\n"
        "via ABA PAY\n"
        "at 7-ELEVEN STORE.\n"
        "Trx. ID: TX_99012\n"
        "APV: 102934"
    )
    result = parse_telegram_message(text)
    assert result is not None
    assert result["customer_name"] == name
    assert result["phone"] == "*123"
    assert result["amount"] == 25.50
    assert result["currency"] == "USD"
    assert result["merchant"] == "7-ELEVEN STORE"


def test_parse_complex_merchants():
    text = (
        "Bakong:\n"
        "៛50,000 paid by SOK CHEAT (*888)\n"
        "on Jul 04, 02:14 PM\n"
        "via Bakong\n"
        "at CHIP MONG 271 MEGA MALL.\n"
        "Transaction ID: BK_77192"
    )
    result = parse_telegram_message(text)
    assert result is not None
    assert result["bank"] == "Bakong"
    assert result["amount"] == 50000.0
    assert result["currency"] == "KHR"
    assert result["merchant"] == "CHIP MONG 271 MEGA MALL"
    assert result["transaction_id"] == "BK_77192"


def test_parse_aba_khqr():
    text = (
        "PayWay by ABA:\n"
        "$12.00 paid by DARA SAM (*456)\n"
        "on Jul 04, 02:14 PM\n"
        "via ABA KHQR\n"
        "at COFFEE & BAKERY\n"
        "Trx. ID: KHQR-88291029-A\n"
        "APV: 991823"
    )
    result = parse_telegram_message(text)
    assert result is not None
    assert result["bank"] == "ABA"
    assert result["payment_method"] == "ABA KHQR"
    assert result["amount"] == 12.0
    assert result["currency"] == "USD"
    assert result["merchant"] == "COFFEE & BAKERY"
    assert result["transaction_id"] == "KHQR-88291029-A"


def test_parse_acleda_ref():
    text = (
        "ACLEDA Bank:\n"
        "៛100,000 paid by VANNAK CHEN\n"
        "on Jul 04, 02:14 PM\n"
        "via ACLEDA\n"
        "to LUCKY SUPERMARKET (TK)\n"
        "Ref: 00192841"
    )
    result = parse_telegram_message(text)
    assert result is not None
    assert result["bank"] == "ACLEDA"
    assert result["customer_name"] == "VANNAK CHEN"
    assert result["amount"] == 100000.0
    assert result["currency"] == "KHR"
    assert result["merchant"] == "LUCKY SUPERMARKET (TK)"
    assert result["transaction_id"] == "00192841"


def test_parse_invalid_text():
    assert parse_telegram_message("") is None
    assert parse_telegram_message("Hello, how are you today?") is None
    assert parse_telegram_message("Random chat message without transaction id") is None


def test_format_amount():
    assert format_amount(10000, "KHR") == "៛10,000"
    assert format_amount(25.5, "USD") == "$25.50"
