//This is the entry point of the app. All execution begins from here.
const { app, BrowserWindow, ipcMain } = require('electron') //Electron is a framework that allows node js to be used locally.
const path = require('path')
var pbkdf2 = require('pbkdf2')
var crypto = require('crypto');
var fs  = require('fs');
const { ECONNRESET } = require('constants');
const { eventNames } = require('process');
const algorithm = 'aes-256-cbc';
//Open the serial port and create handlers for events on it
var SerialPort = require('serialport');
var myPort = new SerialPort("/dev/pts/13", 9600);
var Readline = SerialPort.parsers.Readline;	
var parser = new Readline();								
myPort.pipe(parser);
var ardV = "udef";											
SerialPort.list().then (
  ports => ports.forEach(port =>console.log(port.path)),
  err => console.log(err)
)
myPort.on('open', () => {
  ipcMain.send("ardopen", "true");
  fs.readFile('/var/lib/rfidstore/ardcheck', 'utf-8', (err, data) => {
    ardV = data;
  });
});    
parser.on('data', (data) => {
  console.log(data);
  var indata = crypto.createHash("sha256").update(data, 'utf-8').digest('hex');
  console.log("indata = " + indata + "ardV = " + ardV);
  if (indata === ardV) {
    ipcMain.send("unlock", "true");
  } else {
    ipcMain.send("unlock", "false");
  }
}); 
//Unused example text
const enctext = Buffer.from("This is some text to be encrypted", "utf-8");
var curruname = "Guest";
function createWindow (name) {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      //Allow requires in browser scripts for ipcRenderer
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  // and load the index.html of the app.
  mainWindow.loadFile(name)

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow("index.html")
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
//Functions for encryption and decryption. Supplying a buffer as opposed to a utf8 string is recommended for 
//each of the tags. Utf8 encoding can add extra tags on the end of the strings which changes the hash.
function encrypt(secretKey, salt, content, _callback) {
  const iv = crypto.randomBytes(16);
  ivs = iv.toString('hex');
  const cipher = crypto.createCipheriv(algorithm, secretKey, salt.slice(0, 16));
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  _callback(encrypted);
}
function decrypt(secretKey, salt, cipher, _callback) {
  const decipher = crypto.createDecipheriv(algorithm, secretKey, salt.slice(0, 16));
  const decrpyted = Buffer.concat([decipher.update(cipher), decipher.final()]);
  _callback(decrpyted);
}
//Reply with the current username on data requested from the page. IpcMain and IpcRenderer 
//are event emitters for communicated from server to webpage.
ipcMain.on('Recieve-DataRequest', (event, arg) => {
  event.reply('webdata-back', curruname);
})
//Recieve login data from index.html and check it. Reply with true if the user can authenticate. 
ipcMain.on('async-form', (event, arg) => {
  const valarr = arg.split(";");
  const pword = valarr[0];
  const uname = valarr[1];
  try {
    if (fs.existsSync("/var/lib/rfidstore/mastersum")) {
      fs.readFile('/var/lib/rfidstore/mastersum', 'utf-8', (err, data) => {
        if (err) {
          console.error(err);
          return;
        }
        else {
        fs.readFile('/var/lib/rfidstore/mastertable', 'hex', (err, data_enc) => {
          datab = Buffer.from(data_enc, 'hex')
          //Verifies if the user has the corect password before doing the more computationally more expensive pbkdf2 decryption
          var allacc = data.split('\n');
          var curracc = "";
          allacc.forEach(element => {
            //This may be excessively computationally expensive. Node js offers no break like function so this was the only option I saw.
            //Check the username against the mastertable and check which user it is. Load their info.
            if (curracc === "" && element.split(':')[0] === uname) {
              curracc = element;
            }
          })
          //Load a user's salt
          const salt = curracc.split(":")[2];
          //Create a hash based on the password provided and the salt. If it is the same as the one in the database,
          //attempt to decrypt.
          var indata = crypto.createHash("sha256").update(pword + salt, 'utf-8').digest('hex');
          if (curracc === (uname + ":" + indata + ":" + salt)) {
            //Derive a key. 
            pbkdf2.pbkdf2(pword, salt, 1, 32, 'sha256', (err, derivedKey) => {
                decrypt(derivedKey, salt, datab, (decryptedtext) => {
                 //Try to decrypt. If the user has the wrong key, the decrypted text will not read BEGINNING_OF_FILE.
                  if (decryptedtext.toString() === "BEGINNING_OF_FILE") {
                   //User has decrypted their passwords and is signed in
                   console.log("Success");
                   curruname = uname;
                   event.reply('async-msgpsd', 'true');
                   //Reply that the user has the correct password so they can be redirected.
                 } else{
                  //User has the correct password but cannot decrypt. This indicates something is wrong with their mastertable. 
                  console.log("Error with decryption. Data may be corrupted.");
                 }
                })            
            });
          } else {
            event.reply('async-msg', 'false');
            //reply that the user has the wrong password.
          }
          });
        }
      });
    
    } else {
      fs.mkdirSync("/var/lib/rfidstore/");
    }
  } catch (err) {
    console.error(err);
  }
}); 