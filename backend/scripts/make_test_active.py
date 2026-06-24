"""Prepara una cuenta de prueba con tarjeta default en Stripe test mode.

Uso (desde backend/, con STRIPE_SECRET_KEY en .env):
    python scripts/make_test_active.py marcia@gmail.com

Crea (o reutiliza) un customer de Stripe test para el email dado, le adjunta
la tarjeta de prueba Visa (pm_card_visa) como método de pago default, e imprime
el customer id para parchear la DB. NO toca la base de datos.
"""
import sys
import os
import stripe
from dotenv import load_dotenv

load_dotenv()


def main():
    if len(sys.argv) != 2:
        print("Uso: python scripts/make_test_active.py <email>")
        sys.exit(1)
    email = sys.argv[1]

    api_key = os.getenv("STRIPE_SECRET_KEY")
    if not api_key or not api_key.startswith("sk_test_"):
        print("Error: STRIPE_SECRET_KEY de test (sk_test_...) no está en .env")
        sys.exit(1)
    stripe.api_key = api_key

    # 1. Customer (reutiliza si ya existe por email)
    existing = stripe.Customer.list(email=email, limit=1).data
    customer = existing[0] if existing else stripe.Customer.create(
        email=email, description="SyqueX prueba manual modal tarjeta"
    )
    print(f"CUSTOMER_ID={customer.id}")

    # 2. Adjuntar tarjeta de prueba y dejarla como default
    pm = stripe.PaymentMethod.attach("pm_card_visa", customer=customer.id)
    stripe.Customer.modify(
        customer.id,
        invoice_settings={"default_payment_method": pm.id},
    )
    print(f"PAYMENT_METHOD={pm.id} ({pm.card.brand} ****{pm.card.last4})")
    print("OK")


if __name__ == "__main__":
    main()
