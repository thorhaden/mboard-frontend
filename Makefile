.PHONY: serve deploy

# Serve site/ on http://localhost:8080. The page then calls the API on http://localhost:8000.
serve:
	python3 -m http.server -d site 8080

# Upload site/ to the site bucket and invalidate CloudFront's cache.
deploy:
	scripts/deploy.sh
