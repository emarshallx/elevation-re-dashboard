"""Start the Elevation dashboard.

In PyCharm: open this folder as a project, set a Python 3.10+ interpreter,
install requirements.txt, then run this file (or the bundled "Elevation"
run configuration). Your browser opens at http://127.0.0.1:8050.
"""
import threading
import webbrowser

from elevation import config, create_app

app = create_app()

if __name__ == "__main__":
    url = f"http://{config.HOST}:{config.PORT}"
    if config.OPEN_BROWSER:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"\n  Elevation is running at {url}  (Ctrl+C to stop)\n")
    app.run(host=config.HOST, port=config.PORT, debug=False)
