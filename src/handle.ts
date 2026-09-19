/**
 * The handle a note line is signed with, and the one question asked for it.
 *
 * The handle lives in the author setting and nowhere else: the setting was
 * already its home, it is already editable in the settings editor, and it
 * follows the reader to every browser they open the lab from. A reader who
 * has not set one is asked the first time they write a note (ACC-NOTES-178),
 * because that is the moment the handle is needed; asking when the extension
 * starts would stop a reader who writes no note at all.
 */

import { InputDialog } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { TranslationBundle } from '@jupyterlab/translation';

import { DEFAULT_AUTHOR, handleOf } from './notes';

/** The setting the handle is kept in. */
const AUTHOR_SETTING = 'author';

/**
 * The handle in force, and the dialog that fills it.
 *
 * The settings arrive after the plugin starts, so they are handed over when
 * the registry resolves; until then there is no store to read or write, and
 * the command that asks outright is offered greyed.
 */
export class NoteHandle {
  constructor(trans: TranslationBundle) {
    this._trans = trans;
  }

  /** The settings the handle is kept in, once the registry has resolved. */
  set settings(settings: ISettingRegistry.ISettings) {
    this._settings = settings;
  }

  /** Whether there is a store to read and write, so a question can be put. */
  get ready(): boolean {
    return this._settings !== null;
  }

  /**
   * The handle the reader has set, as a note line will carry it, and empty
   * where they have set none. It is read the way the signer reads it, so a
   * setting holding only an @ or only spaces counts as none and the question
   * is put again rather than the reader being signed with the default and
   * never asked why.
   */
  get current(): string {
    const value = this._settings?.composite[AUTHOR_SETTING];
    return handleOf(typeof value === 'string' ? value : '');
  }

  /**
   * Ask for a handle before the first note is written, and only then: a
   * handle already set is not questioned, and a reader who skipped the
   * dialog is left alone until the lab is loaded again.
   *
   * A second note saved while the question is still open waits for it. The
   * setting is the one place the handle is read from and it is not written
   * until the answer has been round-tripped to the server, so a note that
   * went ahead in the meantime would be signed with the handle the reader
   * is in the middle of replacing.
   */
  async askIfUnset(): Promise<void> {
    if (this._asking) {
      await this._asking;
      return;
    }
    if (this._declined || this.current !== '' || !this._settings) {
      return;
    }
    await this._put(true);
  }

  /** Put one question at a time, so the next caller can wait on this one. */
  private async _put(automatic: boolean): Promise<void> {
    this._asking = this._ask(automatic);
    try {
      await this._asking;
    } finally {
      this._asking = null;
    }
  }

  /**
   * Ask for a handle outright, with the one in force filled in. A question
   * already up is answered first, so the box this one opens with holds the
   * handle as it stands rather than the one it stood at before.
   */
  async change(): Promise<void> {
    if (!this._settings) {
      return;
    }
    await this._asking;
    await this._put(false);
  }

  /**
   * Put the question and keep the answer. The automatic question is the one
   * a note put; the other is the command the reader ran themselves.
   *
   * An empty box ends the asking, and what it writes depends on which
   * question was put: from the note it writes nothing and the note is signed
   * with the default handle, and from the command it clears the setting,
   * which is the reader asking for that default outright.
   *
   * Nothing thrown here reaches the note. Writing the setting is a call to
   * the server, and a lab that refuses it - a read-only settings directory
   * among them - would otherwise take down the note the reader was saving.
   * A refused write is recorded as a refusal, so the note is written under
   * the default handle and the question is not put again this session.
   */
  private async _ask(automatic: boolean): Promise<void> {
    const skip = this._trans.__('Skip');
    // What leaving the dialog does, which is the other half of the question
    // and differs by which question was put: the note is written either way,
    // where the command changes nothing. It names its own subject rather
    // than leaning on the sentence before it, which the refusal replaces.
    const leaving = automatic
      ? this._trans.__(
          'Skip, and your notes are signed with the default handle @%1 until you set one.',
          DEFAULT_AUTHOR
        )
      : this._trans.__(
          'Empty it to be signed with the default handle @%1.',
          DEFAULT_AUTHOR
        );
    try {
      let text = this.current;
      let refused = false;
      for (;;) {
        // The set is named as the grammar has it, a to z and not the wider
        // Latin alphabet: the note head is @([A-Za-z0-9_.-]+), so an
        // accented letter is no more writable than a Cyrillic one.
        const purpose = refused
          ? this._trans.__(
              'That holds nothing a handle can carry: a handle is written in a to z, digits, dot, hyphen or underscore.'
            )
          : this._trans.__(
              'Notes you write are signed with this handle, written in a to z, digits, dot, hyphen or underscore.'
            );
        const answer = await InputDialog.getText({
          title: this._trans.__('Set note handle'),
          label: `${purpose} ${leaving}`,
          text,
          placeholder: this._trans.__('initials'),
          okLabel: this._trans.__('Save'),
          cancelLabel: automatic ? skip : this._trans.__('Cancel')
        });
        if (!answer.button.accept) {
          // Only the named Skip says anything about signing. Escape, the
          // close cross and a click on the overlay - the second press of a
          // double click on Save among them - all resolve with JupyterLab's
          // own default cancel button, which never carries this label, so
          // the question still stands and the next note puts it again.
          if (automatic && answer.button.label === skip) {
            this._declined = true;
          }
          return;
        }
        // What is kept is what a note line will carry, so the setting, the
        // box the next question opens with and the signed line all agree.
        const typed = (answer.value ?? '').trim();
        const handle = handleOf(typed);
        if (typed !== '' && handle === '') {
          // A name the note grammar cannot carry is not the empty box
          // asking for the default. Nothing is written, so a handle the
          // reader already had is left standing rather than wiped, and the
          // question is put again saying so, with what they typed still in
          // the box: a dialog that closes on Save having done nothing tells
          // the reader nothing at all.
          refused = true;
          text = typed;
          continue;
        }
        this._declined = handle === '';
        if (handle !== '' || !automatic) {
          await this._settings!.set(AUTHOR_SETTING, handle);
        }
        return;
      }
    } catch (reason) {
      console.error('Failed to save the note handle.', reason);
      this._declined = true;
    }
  }

  private _trans: TranslationBundle;
  private _settings: ISettingRegistry.ISettings | null = null;
  private _declined = false;
  private _asking: Promise<void> | null = null;
}
