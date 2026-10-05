"""Cria projetos (categorias do showroom) na coleção "projects" do Firestore.

Uso:
    python seed_projects.py "Nome do projeto 1" "Nome do projeto 2" ...

Idempotente: projeto cujo slug já existe é ignorado (não duplica nem altera).
A ordem segue a sequência dos argumentos, depois dos projetos já existentes.
Usa o mesmo projeto Firebase do backend (FIREBASE_PROJECT_ID no .env).
"""
import asyncio
import sys

import storage

CREATED_BY = "seed_projects.py"


async def _seed(names: list[str]) -> None:
    existing_slugs = {p.get("slug") for p in await storage.get_projects()}

    for name in names:
        slug = storage.generate_slug(name)
        if not slug:
            print(f"IGNORADO: '{name}' não gera um slug válido.")
            continue
        if slug in existing_slugs:
            print(f"JÁ EXISTE: '{name}' (slug '{slug}').")
            continue

        project = await storage.create_project(name, created_by=CREATED_BY)
        existing_slugs.add(slug)
        print(f"CRIADO: '{project.get('name')}' (slug '{project.get('slug')}', ordem {project.get('order')}).")


def main():
    names = [n.strip() for n in sys.argv[1:] if n.strip()]
    if not names:
        print(__doc__)
        sys.exit(1)
    if not storage.db:
        print("Firestore não inicializado; verifique a credencial e o FIREBASE_PROJECT_ID.")
        sys.exit(1)

    print(f"Projeto Firebase: {storage.db.project}")
    asyncio.run(_seed(names))


if __name__ == "__main__":
    main()
