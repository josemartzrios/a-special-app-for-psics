"""Unit tests for services/password.py — hash, verify, validate, token."""
import pytest
from services.password import hash_password, verify_password, validate_password, hash_token


class TestHashPassword:
    def test_returns_hash_not_plaintext(self):
        result = hash_password("Password1")
        assert result != "Password1"

    def test_hash_starts_with_bcrypt_prefix(self):
        result = hash_password("Password1")
        assert result.startswith("$2b$")

    def test_different_calls_produce_different_hashes(self):
        # bcrypt uses a random salt — same input must not produce same hash
        h1 = hash_password("Password1")
        h2 = hash_password("Password1")
        assert h1 != h2


class TestVerifyPassword:
    def test_correct_password_returns_true(self):
        hashed = hash_password("Password1")
        assert verify_password("Password1", hashed) is True

    def test_wrong_password_returns_false(self):
        hashed = hash_password("Password1")
        assert verify_password("WrongPass1", hashed) is False

    def test_empty_password_returns_false(self):
        hashed = hash_password("Password1")
        assert verify_password("", hashed) is False


class TestValidatePassword:
    def test_valid_password_returned_unchanged(self):
        result = validate_password("ValidPass1")
        assert result == "ValidPass1"

    def test_too_short_raises(self):
        with pytest.raises(ValueError, match="Mínimo 8 caracteres"):
            validate_password("Short1")

    def test_no_uppercase_raises(self):
        with pytest.raises(ValueError, match="mayúscula"):
            validate_password("alllower1")

    def test_no_number_raises(self):
        with pytest.raises(ValueError, match="número"):
            validate_password("NoNumbers")

    def test_multiple_errors_combined_in_message(self):
        with pytest.raises(ValueError) as exc_info:
            validate_password("x")
        msg = str(exc_info.value)
        assert "Mínimo" in msg
        assert "mayúscula" in msg
        assert "número" in msg


class TestHashToken:
    def test_returns_64_hex_chars(self):
        result = hash_token("some-raw-token")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_same_input_same_hash(self):
        assert hash_token("abc") == hash_token("abc")

    def test_different_inputs_different_hashes(self):
        assert hash_token("token-a") != hash_token("token-b")
