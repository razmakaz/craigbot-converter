# Craig Converter

## Description

Craigbot Converter is a web application that allows users to upload ZIP files containing FLAC audio files. The application processes these files, converts them to MP3 format, and provides a download link for the processed files. It also supports real-time progress updates via WebSockets.

## Requirements

- ffmpeg in your PATH or Environment Variables
- Node.js (version 14.x or higher)
- npm (version 6.x or higher)

## Installation

1. Clone the repository:

   ```sh
   git clone https://github.com/yourusername/craig-converter.git
   cd craig-converter
   ```

2. Install the dependencies:

   ```sh
   npm install
   ```

## Starting the Server

1. Start the server:

   ```sh
   node server.js
   ```

2. Open your web browser and navigate to:

   ```
   http://localhost:3000
   ```

3. You can use serveo to host this for other people to use:

   ```
   ssh -R 80:localhost:3000 serveo.net
   ```

## Usage

1. Upload a ZIP file containing FLAC audio files using the provided form on the web page.
2. The server will process the ZIP file, convert the FLAC files to MP3 format, and provide a download link for the processed files.
3. You can check the processing status by navigating to:

   ```
   http://localhost:3000/status/<fileId>
   ```

4. Download the processed file by navigating to:

   ```
   http://localhost:3000/download/<fileId>
   ```

## License

This project is licensed under the ISC License.
