const http = require('http');

/**
 * Retrieves the action inputs from github core and returns them as a object
 * @param {core} core
 * @return {*} an object with all the input fields
 * (whether they are defined or not)
 */
function retrieveInputs(core, inputFields = []) {
  let inputs = {};
  inputFields.forEach(inputName => inputs[inputName] = core.getInput(inputName));
  return inputs;
}

/**
 * Reads the contents of the file at the given path and returns the contents as
 * an object
 * @param  {string} jsonString absolute path to the file to read
 * @return {any | undefined} parsed contents of the file,
 * or undefined if the file is empty
 */
function parseStringAsJson(jsonString) {
  let parsedObj;
  if (stringHasContent(jsonString)) {
    parsedObj = JSON.parse(jsonString);
  }
  return parsedObj;
}

/**
 * Validates the given BuildParms object to ensure that all the fields
 * are filled in.
 * @param  {BuildParms} buildParms the BuildParms object to check
 * @return {boolean} boolean indicating whether the build parms are valid
 */
function validateBuildParms(buildParms, requiredFields = []) {
  let isValid = false;
  if (buildParms !== null && buildParms !== undefined) {
    isValid = true;

    requiredFields.forEach(field => {
      if (!stringHasContent(buildParms[field])) {
        isValid = false;
        console.error(getMissingInputMessage(field));
      }
    });
  }
  return isValid;
}

/**
 * Gets a message which indicates that a required input field is missing.
 * @param {string} fieldName the name of the buildParms field which is required and not found
 * @returns {string} a message telling the user that the required field must be specified. The 
 * build parms field name has been replaced with a more meaningful name.
 */
function getMissingInputMessage(fieldName) {
  let fieldNameReplacement = {
    containerId: 'n assignment ID',
    releaseId: ' release ID',
    taskLevel: ' level',
    taskIds: ' list of task IDs'
  }

  return `Missing input: a${fieldNameReplacement[fieldName]} must be specified.`
}

/**
 * Converts the given data object to a JSON string
 * @param  {any} data
 * @return {string} JSON representing the given object. Returns an empty
 * string if the object is null
 */
function convertObjectToJson(data) {
  let dataStr = '';
  if (data !== null && data != undefined) {
    dataStr = JSON.stringify(data);
  }
  return dataStr;
}

/**
 * Assembles the URL to use when sending the generate request.
 * @param  {string} cesUrl the base CES URL that was passed in the action
 * arguments
 * @param  {string} srid the SRID for this ISPW
 * @param  {BuildParms} buildParms the BuildParms object with all the fields
 * filled in
 * @return {URL} the url for the request
 */
function assembleRequestUrl(cesUrl, srid, buildParms) {
  // remove trailing '/compuware' from url, if it exists
  let lowercaseUrl = cesUrl.toLowerCase();
  const cpwrIndex = lowercaseUrl.lastIndexOf('/compuware');
  if (cpwrIndex > 0) {
    cesUrl = cesUrl.substr(0, cpwrIndex);
  }

  // remove trailing '/ispw' from url, if it exists
  lowercaseUrl = cesUrl.toLowerCase();
  const ispwIndex = lowercaseUrl.lastIndexOf('/ispw');
  if (ispwIndex > 0) {
    cesUrl = cesUrl.substr(0, ispwIndex);
  }

  // remove trailing slash
  if (cesUrl.endsWith('/')) {
    cesUrl = cesUrl.substr(0, cesUrl.length - 1);
  }

  let tempUrlStr = cesUrl.concat(`/ispw/${srid}/assignments/`);
  tempUrlStr = tempUrlStr.concat(buildParms.containerId);
  tempUrlStr = tempUrlStr.concat('/taskIds/generate-await?');
  buildParms.taskIds.forEach((id) => {
    tempUrlStr = tempUrlStr.concat(`taskId=${id}&`);
  });
  tempUrlStr = tempUrlStr.concat(`level=${buildParms.taskLevel}`);

  const url = new URL(tempUrlStr);
  return url;
}

/**
 * Checks to make sure a string is not undefined, null, or empty
 * @param  {string | undefined} inputStr the string to check
 * @return {boolean} a boolean indicating whether the string has content
 */
function stringHasContent(inputStr) {
  let hasContent = true;
  if (inputStr === null || inputStr === undefined || inputStr.length === 0) {
    hasContent = false;
  }
  return hasContent;
}

/**
 * Assembles an object for the CES request body.
 * @param  {string | undefined} runtimeConfig the runtime configuration passed
 * in the inputs
 * @param  {string | undefined} changeType the change type passed in the inputs
 * @param  {string | undefined} executionStatus the execution status passed
 * in the inputs
 * @param  {string | undefined} autoDeploy whether to auto deploy
 * @return {any} an object with all the fields for the request body filled in
 */
function assembleRequestBodyObject(runtimeConfig, changeType,
    executionStatus, autoDeploy) {
  const requestBody = {};
  if (stringHasContent(runtimeConfig)) {
    requestBody.runtimeConfig = runtimeConfig;
  }
  if (stringHasContent(changeType)) {
    requestBody.changeType = changeType;
  }
  if (stringHasContent(executionStatus)) {
    requestBody.execStat = executionStatus;
  }
  requestBody.autoDeploy = (autoDeploy === 'true');

  return requestBody;
}

/**
 * Gets a promise for sending an http request
 * @param {URL} requestUrl the URL to send hte request to
 * @param {string} token the token to use during authentication
 * @param {string} requestBody the request body
 * @return {Promise} the Promise for the request
 */
function getHttpPromise(requestUrl, token, requestBody) {
  const requestCall = new Promise((resolve, reject) => {
    const options = {
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname + requestUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'authorization': token,
      },
    };
    const req = http.request(options, function(response) {
      let data = '';
      response.on('data', function(chunk) {
        data += chunk;
      });
      response.on('end', function() {
        data = JSON.parse(data);
        // promise resolved on success
        resolve(data);
      });
      response.on('error', function(error) {
        reject(error);
      });
    });
    req.on('error', function(error) {
      reject(error);
    });

    req.write(requestBody);
    req.end();
  });

  return requestCall;
}

/**
 * Examines the given response body to determine whether an error occurred
 * during the generate.
 * @param {*} responseBody The body returned from the CES request
 * @return {*} The response body object if the generate was successful,
 * else throws an error
 * @throws GenerateFailureException if there were failures during the generate
 */
function handleResponseBody(responseBody) {
  if (responseBody === undefined) {
    // empty response
    throw new GenerateFailureException(
        'No response was received from the generate request.');
  } else if (responseBody.awaitStatus === undefined) {
    // message may have been returned
    if (responseBody.message) {
      console.log(responseBody.message);
    }
    throw new GenerateFailureException(
        'The generate did not complete successfully.');
  } else if (responseBody.awaitStatus.generateFailedCount !== 0) {
    console.error(getStatusMessageToPrint(responseBody.awaitStatus.statusMsg));
    throw new GenerateFailureException(
        'There were generate failures.');
  } else {
    // success
    console.log(getStatusMessageToPrint(responseBody.awaitStatus.statusMsg));
    return responseBody;
  }
}

/**
 * The status message in the awaitStatus may be a single string, or an array.
 * This method determines what the status contains and returns a single string.
 * @param {string | Array} statusMsg the statusMsg inside the awaitStatus in
 * the responseBody
 * @return {string} the statusMsg as a single string.
 */
function getStatusMessageToPrint(statusMsg) {
  let message = '';
  if (typeof statusMsg == 'string') {
    message = statusMsg;
  } else if (statusMsg instanceof Array) {
    statusMsg.forEach((line) => message = message + `${line}\n`);
  }
  return message;
}

/**
 * Error to throw when the response for the generate request is incomplete
 *  or indicates errors.
 * @param  {string} message the message associated with the error
 */
function GenerateFailureException(message) {
  this.message = message;
  this.name = 'GenerateFailureException';
}
GenerateFailureException.prototype = Object.create(Error.prototype);

module.exports = {
  retrieveInputs,
  parseStringAsJson,
  validateBuildParms,
  convertObjectToJson,
  assembleRequestUrl,
  assembleRequestBodyObject,
  stringHasContent,
  GenerateFailureException,
  handleResponseBody,
  getHttpPromise,
};
