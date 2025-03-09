# RepoPrompt

RepoPrompt is an unofficial pure-JavaScript open-source clone of [Repo Prompt](https://repoprompt.com/). This tool allows you to generate an XML representation of your project files and custom prompts to feed into a language model's chat interface for further processing.

## Table of Contents

- [Environment Setup](#environment-setup)
- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Usage Instructions](#usage-instructions)
- [Custom Prompts](#custom-prompts)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Environment Setup

This tool requires [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) to run. It is recommended to install Node.js using [nvm (Node Version Manager)](https://github.com/nvm-sh/nvm) so that you can easily manage multiple Node.js versions on your system.

1. **Install nvm (if not already installed):**

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   ```

2. **Install Node.js using nvm:**

   ```bash
   nvm install node
   nvm use node
   ```

3. **Verify the installation:**

   ```bash
   node -v
   npm -v
   ```

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/dav-ell/repoprompt.git
   cd repoprompt
   ```

2. Install the required dependencies:

   ```bash
   npm install
   ```

## Running the Application

### Server

The **server** should be run on the machine that has access to the code you wish to edit. This server will serve the directory contents and file information to the client.

1. To start the server, run:

   ```bash
   cd repoprompt/
   npm start
   ```

   The server will start on port `3000` by default.

### Client

The **client** is a static interface and can be run on any machine. Simply open the `public/index.html` file in your web browser. Alternatively, you can deploy it on any static file server, e.g. `npm install -g live-server && live-server` or `python3 -m http.server 8000`.

## Usage Instructions


1. **Endpoint URL Input:**

   - Enter the endpoint URL where the server is running. For example, if the server is on the same machine, use `http://localhost:3000`. If the server is on another machine, use its IP address or domain (e.g., `http://192.168.1.100:3000`).

2. **Connecting to the Server:**

   - Click on the **Connect** button. The tool will attempt to establish a connection with the server using HTTPS and will fallback to HTTP if necessary.
   - The connection status will be updated in the interface.

3. **Directory Path Input:**

   - Paste the full directory path of the project you want to edit into the **Directory Path** field. This should be an absolute path (e.g., `/home/user/project` or `C:\Users\user\project`).
   - THe server will adhere to your .gitignore. Any files you want excluded from your file explorer, put in that directory's gitignore.

4. **File Selection:**

   - The file explorer on the left will display the project files fetched from the server.
   - Click on individual files or folders to select them. Selected files will be highlighted.
   - File selections are used to determine which file contents will be included in the generated XML.

5. **User Instructions:** (most important step)

   - Enter the instructions you want the model to follow. E.g. "there's a bug in feature X, please fix!" 
   - _Everything else is context for these instructions._

6. **Custom Prompts:**

   - These are prompts that you use to make the model follow a particular pattern. E.g. "always output the entire file when you make code changes."
   - You can manage custom prompts by clicking the **Manage Prompts** button.
   - In the prompt modal, add a new prompt by providing a unique prompt name and the corresponding prompt text.
   - Edit or delete existing prompts as required.
   - Use the checkboxes to select which prompts you want to include in the final XML.

7. **Copying XML:**

   - The XML preview will be generated on the right side of the interface.
   - Click the **Copy XML** button to copy the generated XML to your clipboard.
   - You can then paste this XML into the chat interface of your preferred language model (LLM) for further processing.

## Troubleshooting

- **Connection Issues:**
  - Ensure that the server is running and the correct endpoint URL is entered.
  - Check your network connection if you are running the client on a different machine.

- **Directory Not Loading:**
  - Verify that the directory path is correct and accessible from the server machine.
  - Ensure the server has proper read permissions for the specified directory.
  - Ensure any .gitignore top-level files don't exclude files you want.

- **XML Preview Not Updating:**
  - Make sure files are selected in the file explorer.
  - Check the browser console for any error messages.

## License

This project is licensed under Apache 2.0. See the [LICENSE](LICENSE) file for details.