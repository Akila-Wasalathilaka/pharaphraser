document.getElementById('paraphraseBtn').addEventListener('click', async () => {
  const input = document.getElementById('input').value.trim();
  const output = document.getElementById('output');
  const loading = document.getElementById('loading');
  const btn = document.getElementById('paraphraseBtn');

  if (!input) {
    output.textContent = 'Please enter some text to paraphrase.';
    return;
  }

  // Show loading
  loading.style.display = 'block';
  btn.disabled = true;
  output.textContent = '';

  try {
    const response = await fetch('/paraphrase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: input }),
    });

    const data = await response.json();

    if (response.ok) {
      output.textContent = data.paraphrased;
    } else {
      output.textContent = `Error: ${data.error}`;
    }
  } catch (error) {
    output.textContent = 'An error occurred. Please try again.';
    console.error('Fetch error:', error);
  } finally {
    // Hide loading
    loading.style.display = 'none';
    btn.disabled = false;
  }
});