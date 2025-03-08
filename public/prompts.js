// prompts.js
// This file contains the prompt texts used by the application

/**
 * Meta prompt text used in the XML output.
 */
const metaPromptText = `Think through the problem carefully. Do not be lazy. If there is code, output all code in full, DO NOT show me only changes to code and NEVER include "implementation here", "same as before", etc. It should be possible to copy/paste all the code you generate into individual files and have the code run. DO NOT output files where no changes are needed, just say that file needs no changes and move on. Code should be production-level, complete, and well-documented, NEVER example code, shortened, or incomplete. Do not remove comments that currently exist and don't require changing. Provide an explanation of the changes you are making prior to outputting your results.`;