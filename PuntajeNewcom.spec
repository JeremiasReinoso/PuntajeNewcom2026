# -*- mode: python ; coding: utf-8 -*-
"""
Especificación de PyInstaller (--onedir) para PuntajeNewcom en Kali Linux (x86_64).
Genera la distribución independiente en: dist/PuntajeNewcom-Linux/PuntajeNewcom
"""

block_cipher = None

added_files = [
    ('index.html', '.'),
    ('app.js', '.'),
    ('styles.css', '.'),
    ('DOCUMENTACION.md', '.'),
    ('README.md', '.'),
    ('src', 'src'),
    ('assets', 'assets'),
]

excluded_modules = [
    'PyQt5',
    'PyQt6',
    'PySide6',
    'gi',
    'tkinter',
    'matplotlib',
    'numpy',
    'scipy',
    'pandas',
    'django',
    'flask',
    'fastapi',
    'uvicorn',
    'PIL',
    'weasyprint',
    'cryptography',
    'OpenSSL',
    'twisted',
    'celery',
    'sqlalchemy',
    'pytest',
    'IPython',
    'zmq',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=added_files,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excluded_modules,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='PuntajeNewcom',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/puntajenewcom.png',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='PuntajeNewcom-Linux',
)
