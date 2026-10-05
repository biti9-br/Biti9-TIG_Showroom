"""Define o papel (custom claim "role") de um usuário no Firebase Auth.

Uso:
    python set_admin.py <email-ou-uid> [admin|colaborador]

Exemplo (primeiro admin):
    python set_admin.py biti9.andre@tigre.com

O usuário precisa ter feito login no app ao menos uma vez (para existir no
Firebase Auth) e deve deslogar/logar de novo para o papel valer.
Requer credencial com permissão de Auth admin (serviceAccountKey.json).
"""
import sys
from firebase_admin import auth

import storage  # noqa: F401  (inicializa o firebase_admin com a mesma config do backend)

ROLES = ("admin", "colaborador")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    target = sys.argv[1]
    role = sys.argv[2] if len(sys.argv) > 2 else "admin"
    if role not in ROLES:
        print(f"Role inválida: {role}. Use {' ou '.join(ROLES)}.")
        sys.exit(1)

    user = auth.get_user_by_email(target) if "@" in target else auth.get_user(target)
    claims = dict(user.custom_claims or {})
    claims["role"] = role
    auth.set_custom_user_claims(user.uid, claims)
    print(f"OK: {user.email} ({user.uid}) agora é '{role}'. Deslogue e logue de novo para valer.")


if __name__ == "__main__":
    main()
